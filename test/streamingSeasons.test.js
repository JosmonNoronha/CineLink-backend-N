jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const m = require('../src/services/streaming/matcher');
const seasons = require('../src/services/streaming/seasons');
const { createCatalog, chunkOf } = require('../src/services/streaming/catalog');
const { createStreamingService } = require('../src/services/streaming/service');
const { syncShow } = require('../src/services/streaming/sync');
const { uploadsPlaylistId } = require('../src/services/streaming/youtube');
const { fillGaps, missingKeys } = require('../src/services/streaming/gaps');
const { getShow, listShows } = require('../src/services/streaming/shows');

const lie = getShow(292203);
const tmkoc = getShow(8630);
const ch = lie.channels[0];
const vid = (n) => `v${String(n).padStart(10, '0')}`; // 11 chars

/** Smallest Firestore double that catalog.js needs: documents addressed by path. */
function fakeFirestore() {
  const store = new Map();
  const doc = (path) => ({
    async get() {
      return { exists: store.has(path), data: () => store.get(path) };
    },
    async set(data) {
      store.set(path, JSON.parse(JSON.stringify(data)));
    },
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id}`),
    async get() {
      const docs = [...store.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .map(([, v]) => ({ data: () => v }));
      return { docs };
    },
  });
  return { collection };
}

/** Fake YouTube for one channel: uploads = [{ n (unique), title, seconds? }] */
function fakeYouTube(uploads, { search = {} } = {}) {
  const usage = { units: 0 };
  const queries = [];
  return {
    usage,
    queries,
    async listUploads(playlistId, { max }) {
      usage.units += 1;
      return playlistId === uploadsPlaylistId(ch.id)
        ? uploads.slice(0, max).map((u) => ({ videoId: vid(u.n), title: u.title, publishedAt: '2026-10-01T00:00:00Z' }))
        : [];
    },
    async videoDetails(ids) {
      usage.units += 1;
      const out = new Map();
      uploads
        .filter((u) => ids.includes(vid(u.n)))
        .forEach((u) =>
          out.set(vid(u.n), {
            channelId: ch.id,
            seconds: u.seconds ?? 3500,
            embeddable: true,
            privacy: 'public',
            ageRestricted: false,
            region: null,
          })
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

const s1 = (e) => ({ n: e, title: `LIE HARD Ep. ${e} | Comedians bluff for cash` });
const s2 = (e, n = 100 + e) => ({ n, title: `LIE HARD S2 Ep ${String(e).padStart(2, '0')} | New guests` });

describe('parseSeason', () => {
  test.each([
    ['LIE HARD S2 Ep 01 | Gaurav Kapoor', 2],
    ['LIE HARD S2E05', 2],
    ['Lie Hard Season 3 Episode 4', 3],
    ['LIE HARD S02 Ep 10', 2],
    ['LIE HARD Ep. 1', null],
    ["Gaurav's 2 truths and a lie | LIE HARD Ep. 4", null], // apostrophe-s is not a season
    ['Lie Hard Ep 12 | VS 3 teams', null], // a letter run is not a season
  ])('%s -> %s', (title, expected) => expect(m.parseSeason(title)).toBe(expected));
});

describe('seasons helpers', () => {
  test('season 1 keys are the plain episode number; later seasons are offset by 1000', () => {
    expect(seasons.encode(lie, 1, 7)).toBe(7);
    expect(seasons.encode(lie, 2, 1)).toBe(1001);
    expect(seasons.decode(lie, 1001)).toEqual({ season: 2, episode: 1 });
    expect(seasons.decode(lie, 7)).toEqual({ season: 1, episode: 7 });
    expect(seasons.decode(lie, 2010)).toEqual({ season: 3, episode: 10 });
  });

  test('a normal show is untouched: key = episode number, one season', () => {
    expect(seasons.encode(tmkoc, 1, 4851)).toBe(4851);
    expect(seasons.decode(tmkoc, 4851)).toEqual({ season: 1, episode: 4851 });
    expect(seasons.label(tmkoc, 531)).toBe(531);
    expect(seasons.searchQuery(tmkoc, 531)).toBe('Taarak Mehta Ka Ooltah Chashmah Episode 531');
  });

  test('missingKeys works per season, never across the gap between seasons', () => {
    const have = new Map([[1, [{}]], [3, [{}]], [1001, [{}]], [1004, [{}]]]);
    expect(missingKeys(lie, have)).toEqual([2, 1002, 1003]);
    expect(missingKeys(lie, have, { season: 2 })).toEqual([1002, 1003]);
    expect(missingKeys(lie, have).map((k) => seasons.label(lie, k))).toEqual(['S1E2', 'S2E2', 'S2E3']);
    const tm = new Map([[1, [{}]], [4, [{}]]]);
    expect(missingKeys(tmkoc, tm)).toEqual([2, 3]);
  });

  test('config guard: seasonInTitle shows keep maxEpisode below 1000', () => {
    expect(lie.maxEpisode).toBeLessThan(seasons.SPAN);
  });
});

describe('toSource for a multi-season show', () => {
  const video = (title, o = {}) => ({ videoId: vid(1), title, seconds: 3500, embeddable: true, privacy: 'public', ...o });

  test('season 1 title without a season, and season 2 title', () => {
    const a = m.toSource(video('LIE HARD Ep. 1 | Comedians bluff'), lie, ch);
    expect([a.n, a.season, a.episode]).toEqual([1, 1, 1]);
    const b = m.toSource(video('LIE HARD S2 Ep 01 | New guests'), lie, ch);
    expect([b.n, b.season, b.episode]).toEqual([1001, 2, 1]);
  });

  test('clips, short videos, ranges and other shows are rejected', () => {
    expect(m.toSource(video('LIE HARD S2 Ep 01 | Highlights', { seconds: 300 }), lie, ch)).toBeNull();
    expect(m.toSource(video('LIE HARD Ep 1 - 3 | Compilation'), lie, ch)).toBeNull();
    expect(m.toSource(video('LIE HARD Teaser | S2 Ep 01'), lie, ch)).toBeNull();
    expect(m.toSource(video('Gaurav Kapoor stand-up | Ep 3'), lie, ch)).toBeNull();
    expect(m.toSource(video('LIE HARD behind the scenes Ep 1'), lie, ch)).toBeNull();
  });

  test('a single-season show still ignores season markers in titles', () => {
    const t = m.toSource(
      video('Taarak Mehta Ka Ooltah Chashmah S2 Full Episode 4832', { seconds: 1300 }),
      tmkoc,
      { key: 'official', priority: 1 }
    );
    expect(t.n).toBe(4832);
    expect(t.season).toBe(1);
  });
});

describe('sync + service for Lie Hard', () => {
  const uploads = [
    s1(1), s1(2), s1(3),
    s2(1), s2(2), s2(4), // S2E3 missing
    { n: 900, title: 'LIE HARD Official Trailer S2', seconds: 90 },
    { n: 901, title: 'Gaurav Kapoor | Stand-up special', seconds: 3000 },
  ];

  async function build() {
    const catalog = createCatalog(fakeFirestore());
    const report = await syncShow({ show: lie, mode: 'full', youtube: fakeYouTube(uploads), catalog });
    return { catalog, report, service: createStreamingService({ catalog }) };
  }

  test('a full sync keeps both seasons apart and reports each one', async () => {
    const { catalog, report } = await build();
    const eps = await catalog.loadEpisodes(292203);
    expect([...eps.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 1001, 1002, 1004]);
    expect(report.episodes).toBe(6);
    expect(report.seasons).toEqual({ 1: { episodes: 3, latest: 3 }, 2: { episodes: 3, latest: 4 } });
    expect(report.latest).toBeNull();
    expect([chunkOf(1), chunkOf(1001)]).toEqual([0, 4]);
  });

  test('availability returns one season at a time, and says which seasons exist', async () => {
    const { service } = await build();
    const a1 = await service.availability(292203, 'IN');
    expect(a1.season).toBe(1);
    expect(a1.episodes.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(a1.seasons.map((x) => [x.season, x.count, x.latest])).toEqual([
      [1, 3, 3],
      [2, 3, 4],
    ]);
    // all seasons arrive in this one response, so the app never needs a second request
    expect(a1.seasons[1].episodes.map((r) => r[0])).toEqual([1, 2, 4]);
    expect(a1.seasons[1].episodes[0][1]).toBe(vid(101));
    const a2 = await service.availability(292203, 'IN', 2);
    expect(a2.season).toBe(2);
    expect(a2.episodes.map((r) => r[0])).toEqual([1, 2, 4]);
    expect(a2.episodes[0][1]).toBe(vid(101)); // S2 Ep 01 is its own video, not S1's
    expect(a2.latest).toBe(4);
    const a3 = await service.availability(292203, 'IN', 3);
    expect(a3.count).toBe(0);
    expect(a3.seasons).toHaveLength(2);

    // a normal show keeps the compact shape: no per-season episode lists
    const cat = createCatalog(fakeFirestore());
    await cat.saveEpisodes(8630, new Map([[7, [{ v: 'aaaaaaaaaaa', c: 'official', p: 1, s: 1300, r: null, t: 't', d: 1 }]]]));
    const t = await createStreamingService({ catalog: cat }).availability(8630, 'IN');
    expect(t.seasons).toEqual([{ season: 1, count: 1, latest: 7 }]);
    expect(t.episodes).toEqual([[7, 'aaaaaaaaaaa', 0]]);
  });

  test('the show list has one card per show, covering all its seasons', async () => {
    const { service } = await build();
    const list = await service.listShows('IN');
    const mine = list.filter((x) => x.tmdbId === 292203);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Lie Hard', season: 1, seasonCount: 2, count: 6, latest: null });
    expect(list.some((x) => x.tmdbId === 8630)).toBe(false); // nothing synced for TMKOC here
  });

  test('a multi-season show with only season 2 playable starts on season 2', async () => {
    const catalog = createCatalog(fakeFirestore());
    await syncShow({ show: lie, mode: 'full', youtube: fakeYouTube([s2(1), s2(2)]), catalog });
    const list = await createStreamingService({ catalog }).listShows('IN');
    expect(list[0]).toMatchObject({ title: 'Lie Hard', season: 2, count: 2, latest: 2 });
    expect(list[0].seasonCount).toBeUndefined();
  });

  test('episode lookup and report honour the season', async () => {
    const { service } = await build();
    expect((await service.episode(292203, 1, 'IN', 2)).videoId).toBe(vid(101));
    expect((await service.episode(292203, 1, 'IN')).videoId).toBe(vid(1));
    await expect(service.episode(292203, 3, 'IN', 2)).rejects.toMatchObject({ code: 'EPISODE_NOT_AVAILABLE' });
    const r = await service.report(292203, undefined, 2);
    expect(r).toMatchObject({ season: 2, episodesWithVideo: 3, totalChecked: 4, biggestHoles: ['3-3 (1)'] });
    expect(r.seasons).toEqual({ 1: { episodesWithVideo: 3, latest: 3 }, 2: { episodesWithVideo: 3, latest: 4 } });
    const r1 = await service.report(292203);
    expect(r1).toMatchObject({ season: 1, totalChecked: 3, biggestHoles: [] });
  });

  test('gap search asks YouTube for "S2 Ep 3" and files the result under season 2', async () => {
    const { catalog } = await build();
    const have = await catalog.loadEpisodes(292203);
    const missing = missingKeys(lie, have);
    expect(missing).toEqual([1003]);
    const yt = fakeYouTube(uploads, { search: { 'Lie Hard S2 Ep 3': [s2(3, 103)] } });
    // the found video must exist in details, so it is part of the fake channel's uploads
    const withS23 = fakeYouTube([...uploads, s2(3, 103)], { search: { 'Lie Hard S2 Ep 3': [s2(3, 103)] } });
    const res = await fillGaps({ show: lie, youtube: withS23, missing });
    expect(withS23.queries).toEqual(['Lie Hard S2 Ep 3']);
    expect([...res.added.keys()]).toEqual([1003]);
    expect(yt.queries).toEqual([]);
  });
});

describe('a normal show through the same code', () => {
  test('episode numbers, list entry and report are exactly as before', async () => {
    const catalog = createCatalog(fakeFirestore());
    const src = (v, c, p) => ({ v, c, p, s: 1300, r: null, t: 't', d: 1 });
    await catalog.saveEpisodes(8630, new Map([[4851, [src('aaaaaaaaaaa', 'official', 1)]], [2, [src('bbbbbbbbbbb', 'sab', 3)]]]));
    const service = createStreamingService({ catalog });
    const a = await service.availability(8630, 'IN');
    expect(a).toMatchObject({ tmdbId: 8630, title: tmkoc.title, season: 1, count: 2, latest: 4851 });
    expect(a.episodes).toEqual([[2, 'bbbbbbbbbbb', 0], [4851, 'aaaaaaaaaaa', 0]]);
    const list = await service.listShows('IN');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tmdbId: 8630, title: tmkoc.title, season: 1, count: 2, latest: 4851 });
    expect(list[0].seasonCount).toBeUndefined();
    expect((await service.episode(8630, 4851, 'IN')).videoId).toBe('aaaaaaaaaaa');
    const r = await service.report(8630, 5);
    expect(r).toMatchObject({ episodesWithVideo: 2, totalChecked: 5, biggestHoles: ['3-5 (3)', '1-1 (1)'] });
    expect(r.seasons).toBeUndefined();
  });

  test('every configured show is listed by listShows', () => {
    expect(listShows().map((s) => s.tmdbId)).toEqual(expect.arrayContaining([8630, 292203, 275204, 282836, 2328]));
  });
});
