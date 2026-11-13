jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { normaliseName, buildNameIndex, matchName } = require('../src/services/streaming/names');
const { toSource, titleLooksLikeEpisode, parseEpisodeNumber } = require('../src/services/streaming/matcher');
const { createEpisodeNames } = require('../src/services/streaming/tmdbNames');
const { createCatalog } = require('../src/services/streaming/catalog');
const { createStreamingService } = require('../src/services/streaming/service');
const { syncShow } = require('../src/services/streaming/sync');
const { fillGaps, missingKeys } = require('../src/services/streaming/gaps');
const { uploadsPlaylistId } = require('../src/services/streaming/youtube');
const { getShow } = require('../src/services/streaming/shows');

const dhindora = getShow(275204);
const lie = getShow(292203);
const tmkoc = getShow(8630);
const ekaki = getShow(282836);
const ch = dhindora.channels[0];

const TMDB_NAMES = [
  'Lag Gayi', 'Baasi Roti', 'Nano Thug Lenge', 'Saste Sherlock',
  'Erection In Progress', 'DTYDHTB', 'Toota Ek Taara', 'Samay Ka Pahiya',
].map((name, i) => ({ key: i + 1, name }));
const index = () => buildNameIndex(TMDB_NAMES, dhindora);
const vid = (n) => `d${String(n).padStart(10, '0')}`;

function fakeFirestore() {
  const store = new Map();
  const doc = (path) => ({
    async get() { return { exists: store.has(path), data: () => store.get(path) }; },
    async set(data) { store.set(path, JSON.parse(JSON.stringify(data))); },
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id}`),
    async get() {
      return { docs: [...store.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([, v]) => ({ data: () => v })) };
    },
  });
  return { collection };
}

function fakeYouTube(uploads, { search = {}, channel = ch } = {}) {
  const usage = { units: 0 };
  const queries = [];
  return {
    usage,
    queries,
    async listUploads(playlistId, { max }) {
      usage.units += 1;
      return playlistId === uploadsPlaylistId(channel.id)
        ? uploads.slice(0, max).map((u) => ({ videoId: vid(u.n), title: u.title, publishedAt: '2021-11-01T00:00:00Z' }))
        : [];
    },
    async videoDetails(ids) {
      usage.units += 1;
      const out = new Map();
      uploads.filter((u) => ids.includes(vid(u.n))).forEach((u) =>
        out.set(vid(u.n), { channelId: channel.id, seconds: u.seconds ?? 1500, embeddable: true, privacy: 'public', ageRestricted: false, region: null })
      );
      return out;
    },
    async searchVideos(q) {
      usage.units += 100;
      queries.push(q);
      return (search[q] || []).map((u) => ({ videoId: vid(u.n), title: u.title, channelId: ch.id }));
    },
  };
}

describe('normaliseName', () => {
  test('case, accents and punctuation do not matter; other scripts survive', () => {
    expect(normaliseName('  Nano Thug Lenge?! ')).toBe('nano thug lenge');
    expect(normaliseName('Café—Déjà vu')).toBe('cafe deja vu');
    expect(normaliseName('ढिंडोरा | एपिसोड')).toBe('ढिंडोरा एपिसोड');
  });
});

describe('buildNameIndex', () => {
  test('keeps real names, longest first', () => {
    const idx = index();
    expect(idx.entries).toHaveLength(8);
    expect(idx.entries[0].norm.length).toBeGreaterThanOrEqual(idx.entries[7].norm.length);
    expect(idx.byKey.get(1)).toBe('Lag Gayi');
  });

  test('generic, tiny and show-title names are left out, and so are names two episodes share', () => {
    const idx = buildNameIndex(
      [
        { key: 1, name: 'Episode 1' }, { key: 2, name: 'Finale' }, { key: 3, name: 'Ok' },
        { key: 4, name: 'Dhindora' }, { key: 5, name: 'Twin' }, { key: 6, name: 'Twin' }, { key: 7, name: 'Real Name' },
      ],
      dhindora
    );
    expect(idx.entries.map((e) => e.name)).toEqual(['Real Name']);
    expect(idx.skipped).toEqual(expect.arrayContaining(['Episode 1', 'Finale', 'Ok', 'Dhindora', 'Twin']));
  });

  test('copes with missing input', () => {
    expect(buildNameIndex(undefined, dhindora).entries).toEqual([]);
    expect(matchName('anything', null)).toBeNull();
  });
});

describe('matchName', () => {
  const idx = index();
  test.each([
    ['Dhindora | Lag Gayi | Bhuvan Bam', 1],
    ['DHINDORA - NANO THUG LENGE (Full Episode)', 3],
    ['Dhindora: Erection In Progress | BB Ki Vines', 5],
    ['Dhindora | DTYDHTB | Bhuvan Bam', 6],
    ['Bhuvan Bam | Dhindora | Samay Ka Pahiya!', 8],
  ])('%s -> %s', (title, key) => expect(matchName(title, idx)).toBe(key));

  test.each([
    'Dhindora | Official Teaser',
    'Dhindora | Bhuvan Bam | BB Ki Vines',
    'Dhindora | Lag Gayi & Baasi Roti', // two episodes: do not guess
    'Dhindora | Laggayi', // a different spelling is not a match
    'Dhindora | Lag Gayiii', // whole words only
  ])('%s -> no match', (title) => expect(matchName(title, idx)).toBeNull());

  test('a name inside a longer matched name is only part of it', () => {
    const idx2 = buildNameIndex([{ key: 1, name: 'Love Story' }, { key: 2, name: 'Love Story Returns' }], dhindora);
    expect(matchName('Dhindora | Love Story Returns', idx2)).toBe(2);
    expect(matchName('Dhindora | Love Story', idx2)).toBe(1);
  });

  test("the show's own title is not mistaken for an episode name", () => {
    const idx2 = buildNameIndex([{ key: 1, name: 'Dhindora Begins' }], dhindora);
    expect(matchName('Dhindora | Official Teaser', idx2)).toBeNull();
    expect(matchName('Dhindora | Dhindora Begins', idx2)).toBe(1);
  });
});

describe('toSource and titleLooksLikeEpisode with names', () => {
  const idx = index();
  const video = (title, o = {}) => ({ videoId: vid(1), title, seconds: 1500, embeddable: true, privacy: 'public', ...o });

  test('a title with no number matches by name', () => {
    const hit = toSource(video('Dhindora | Saste Sherlock | Bhuvan Bam'), dhindora, ch, idx);
    expect([hit.n, hit.episode, hit.season, hit.by]).toEqual([4, 4, 1, 'name']);
    expect(titleLooksLikeEpisode('Dhindora | Saste Sherlock', dhindora, idx)).toBe(true);
  });

  test('without the index (or on a show that does not use it) nothing changes', () => {
    expect(toSource(video('Dhindora | Saste Sherlock'), dhindora, ch)).toBeNull();
    expect(titleLooksLikeEpisode('Dhindora | Saste Sherlock', dhindora)).toBe(false);
  });

  test('an episode number in the title still wins, and says "number"', () => {
    const hit = toSource(video('Dhindora Episode 2 | Lag Gayi'), dhindora, ch, idx);
    expect([hit.n, hit.by]).toEqual([2, 'number']);
  });

  test('the usual rules still apply to a name match', () => {
    expect(toSource(video('Dhindora | Lag Gayi | Behind The Scenes'), dhindora, ch, idx)).toBeNull();
    expect(toSource(video('Dhindora | Lag Gayi | Trailer'), dhindora, ch, idx)).toBeNull();
    expect(toSource(video('Dhindora | Lag Gayi', { seconds: 120 }), dhindora, ch, idx)).toBeNull();
    expect(toSource(video('Dhindora | Lag Gayi', { embeddable: false }), dhindora, ch, idx)).toBeNull();
    expect(toSource(video('Lag Gayi | Bhuvan Bam'), dhindora, ch, idx)).toBeNull(); // not this show's title
  });

  test('multi-season: the name carries its season into the catalog key', () => {
    const idx2 = buildNameIndex([{ key: 1, name: 'First Night' }, { key: 1003, name: 'Second Wind' }], lie);
    const hit = toSource({ videoId: vid(5), title: 'LIE HARD | Second Wind', seconds: 3500, embeddable: true, privacy: 'public' }, lie, lie.channels[0], idx2);
    expect([hit.n, hit.season, hit.episode, hit.by]).toEqual([1003, 2, 3, 'name']);
  });
});

describe('createEpisodeNames (TMDB)', () => {
  const season1 = { episodes: [{ episode_number: 1, name: 'Lag Gayi' }, { episode_number: 2, name: 'Baasi Roti' }, { episode_number: 0, name: 'Special' }, { episode_number: 3 }] };
  const fakeHttp = (routes) => {
    const calls = [];
    return {
      calls,
      get: jest.fn(async (url, cfg) => {
        calls.push({ url, cfg });
        const path = url.replace('https://api.themoviedb.org/3', '');
        if (routes[path] instanceof Error) throw routes[path];
        if (!(path in routes)) {
          const err = new Error('nf');
          err.response = { status: 404 };
          throw err;
        }
        return { data: routes[path] };
      }),
    };
  };

  test('single-season show: one season request, keys are plain episode numbers', async () => {
    const http = fakeHttp({ '/tv/275204/season/1': season1 });
    const out = await createEpisodeNames({ apiKey: 'a'.repeat(32), http }).forShow(dhindora);
    expect(out).toEqual([{ key: 1, name: 'Lag Gayi' }, { key: 2, name: 'Baasi Roti' }]);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].cfg.params.api_key).toBe('a'.repeat(32)); // v3 key goes in the query
  });

  test('a v4 token goes in a header, never in the query', async () => {
    const http = fakeHttp({ '/tv/275204/season/1': season1 });
    await createEpisodeNames({ apiKey: `eyJ${'x'.repeat(60)}`, http }).forShow(dhindora);
    expect(http.calls[0].cfg.headers.Authorization).toMatch(/^Bearer eyJ/);
    expect(http.calls[0].cfg.params.api_key).toBeUndefined();
  });

  test('multi-season show: reads the season count, then every season', async () => {
    const http = fakeHttp({
      '/tv/292203': { number_of_seasons: 2 },
      '/tv/292203/season/1': { episodes: [{ episode_number: 1, name: 'First Night' }] },
      '/tv/292203/season/2': { episodes: [{ episode_number: 3, name: 'Second Wind' }] },
    });
    const out = await createEpisodeNames({ apiKey: 'k'.repeat(32), http }).forShow(lie);
    expect(out).toEqual([{ key: 1, name: 'First Night' }, { key: 1003, name: 'Second Wind' }]);
  });

  test('extra names from shows.js are added; a missing season is just empty', async () => {
    const show = { ...dhindora, episodeNames: [{ episode: 2, name: 'Basi Roti' }] };
    const out = await createEpisodeNames({ apiKey: 'k'.repeat(32), http: fakeHttp({}) }).forShow(show);
    expect(out).toEqual([{ key: 2, name: 'Basi Roti' }]);
  });

  test('errors never contain the key', async () => {
    const secret = 'SECRET'.repeat(8);
    const err = new Error(`boom ${secret}`);
    err.response = { status: 500 };
    const names = createEpisodeNames({ apiKey: secret, http: fakeHttp({ '/tv/275204/season/1': err }) });
    await expect(names.forShow(dhindora)).rejects.toThrow('TMDB request failed (500)');
    await names.forShow(dhindora).catch((e) => expect(e.message).not.toContain(secret));
    expect(() => createEpisodeNames({})).toThrow('TMDB_API_KEY');
  });
});

describe('syncShow with names', () => {
  const titles = [
    'Dhindora | Lag Gayi | Bhuvan Bam', 'Dhindora | Baasi Roti | Bhuvan Bam', 'Dhindora | Nano Thug Lenge',
    'Dhindora | Saste Sherlock', 'Dhindora Episode 5 | Erection In Progress', 'Dhindora | DTYDHTB',
    'Dhindora | Toota Ek Taara', 'Dhindora | Samay Ka Pahiya',
  ];
  const uploads = [
    ...titles.map((title, i) => ({ n: i + 1, title })),
    { n: 90, title: 'Dhindora | Official Trailer', seconds: 120 },
    { n: 91, title: 'Dhindora | Bhuvan Bam | Behind The Scenes', seconds: 900 },
    { n: 92, title: 'BB Ki Vines | Titu Mama', seconds: 600 },
  ];
  const episodeNames = { forShow: async () => TMDB_NAMES };

  test('all eight episodes are found without a single number in most titles', async () => {
    const catalog = createCatalog(fakeFirestore());
    const report = await syncShow({ show: dhindora, mode: 'full', youtube: fakeYouTube(uploads), catalog, episodeNames });
    expect([...(await catalog.loadEpisodes(275204)).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(report.nameMatch).toMatchObject({ names: 8, videosMatchedByName: 7 }); // episode 5 matched by its number
    const service = createStreamingService({ catalog });
    expect((await service.availability(275204, 'IN')).episodes.map((r) => r[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('the daily "recent" mode uses names too', async () => {
    const catalog = createCatalog(fakeFirestore());
    await syncShow({ show: dhindora, mode: 'recent', youtube: fakeYouTube(uploads), catalog, episodeNames });
    expect((await catalog.loadEpisodes(275204)).size).toBe(8);
  });

  test('TMDB down or no key: the sync still runs on numbers, and says so', async () => {
    const down = { forShow: async () => { throw new Error('TMDB request failed (500)'); } };
    const c1 = createCatalog(fakeFirestore());
    const r1 = await syncShow({ show: dhindora, mode: 'full', youtube: fakeYouTube(uploads), catalog: c1, episodeNames: down });
    expect(r1.nameMatch).toEqual({ error: 'TMDB request failed (500)' });
    expect([...(await c1.loadEpisodes(275204)).keys()]).toEqual([5]); // only the title with a number
    const r2 = await syncShow({ show: dhindora, mode: 'full', youtube: fakeYouTube(uploads), catalog: createCatalog(fakeFirestore()) });
    expect(r2.nameMatch.error).toMatch(/TMDB_API_KEY/);
  });

  test('shows without nameMatch never touch TMDB', async () => {
    const forShow = jest.fn(async () => []);
    const yt = fakeYouTube([]);
    const report = await syncShow({ show: tmkoc, mode: 'recent', youtube: { ...yt, listUploads: async () => [], videoDetails: async () => new Map(), usage: { units: 0 } }, catalog: createCatalog(fakeFirestore()), episodeNames: { forShow } });
    expect(forShow).not.toHaveBeenCalled();
    expect(report.nameMatch).toBeUndefined();
  });
});

describe('gap search by name', () => {
  test('searches "<show> <episode name>" and files the hit under that episode', async () => {
    const idx = index();
    const missing = missingKeys(dhindora, new Map([[1, [{}]], [3, [{}]]]));
    expect(missing).toEqual([2]);
    const found = { n: 2, title: 'Dhindora | Baasi Roti | Bhuvan Bam' };
    const yt = fakeYouTube([found], { search: { 'Dhindora Baasi Roti': [found] } });
    const res = await fillGaps({ show: dhindora, youtube: yt, missing, names: idx });
    expect(yt.queries).toEqual(['Dhindora Baasi Roti']);
    expect([...res.added.keys()]).toEqual([2]);
  });

  test('without names it searches by number as before', async () => {
    const yt = fakeYouTube([]);
    await fillGaps({ show: dhindora, youtube: yt, missing: [2] });
    expect(yt.queries).toEqual(['Dhindora Episode 2']);
  });
});

describe('episodeWords: shows that say "chapter" instead of "episode"', () => {
  test('parseEpisodeNumber only knows the extra word when a show asks for it', () => {
    expect(parseEpisodeNumber('Ekaki | Chapter 5: The Conqueror')).toBeNull();
    expect(parseEpisodeNumber('Ekaki | Chapter 5: The Conqueror', ['chapter'])).toBe(5);
    expect(parseEpisodeNumber('EKAKI chapter-2', ['chapter'])).toBe(2);
    expect(parseEpisodeNumber('Ekaki Chapter 1 - 5 full series', ['chapter'])).toBeNull(); // a range
    expect(parseEpisodeNumber('Ekaki Chapter', ['chapter'])).toBeNull();
    expect(parseEpisodeNumber('Ekaki Episode 4', ['chapter'])).toBe(4); // the normal words still work
  });

  test('a show without episodeWords is untouched', () => {
    expect(toSource({ videoId: vid(1), title: 'Dhindora Chapter 3', seconds: 1500, embeddable: true, privacy: 'public' }, dhindora, ch)).toBeNull();
  });

  const echannel = ekaki.channels[0];
  const uploads = [
    { n: 1, title: 'Ekaki | Chapter 1: The Invitation | Ashish Chanchlani', seconds: 2100 },
    { n: 2, title: 'EKAKI - Chapter 2', seconds: 2300 },
    { n: 3, title: 'Ekaki Chapter 3: Trapped | Horror Comedy', seconds: 2000 },
    { n: 4, title: 'Ekaki | Chapter 4', seconds: 2200 },
    { n: 5, title: 'Ekaki | Final Chapter: The Conqueror | Ashish Chanchlani', seconds: 2600 }, // no number: matched by its TMDB name
    { n: 90, title: 'Ekaki Chapter 5 | Behind The Scenes', seconds: 1200 },
    { n: 91, title: 'Hrithik Roshan reacts to Ekaki', seconds: 400 },
    { n: 92, title: 'Ekaki Chapter 1 - 5 | Full Series', seconds: 9000 },
    { n: 93, title: 'Ashish Chanchlani | Dhindora style vlog', seconds: 900 },
  ];
  const episodeNames = { forShow: async () => [{ key: 5, name: 'Final Chapter: The Conqueror' }] };

  test('all five chapters are found: four by their number, the finale by its name', async () => {
    const catalog = createCatalog(fakeFirestore());
    const report = await syncShow({ show: ekaki, mode: 'full', youtube: fakeYouTube(uploads, { channel: echannel }), catalog, episodeNames });
    expect([...(await catalog.loadEpisodes(282836)).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(report.nameMatch).toMatchObject({ names: 1, videosMatchedByName: 1 });
  });

  test('without TMDB the four numbered chapters are still found', async () => {
    const catalog = createCatalog(fakeFirestore());
    await syncShow({ show: ekaki, mode: 'full', youtube: fakeYouTube(uploads, { channel: echannel }), catalog });
    expect([...(await catalog.loadEpisodes(282836)).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});
