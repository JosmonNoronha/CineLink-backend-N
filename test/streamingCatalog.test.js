require('express-async-errors');
const request = require('supertest');
const express = require('express');

const mockEnv = { YOUTUBE_API_KEY: 'SECRET-KEY-123' };
jest.mock('../src/config/environment', () => ({ env: mockEnv }));
jest.mock('../src/config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: async () => ({}) }),
  getFirestore: () => {
    throw new Error('use injected catalog');
  },
}));
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => {
  const { AppError } = require('../src/utils/errors');
  return {
    authMiddleware: (req, _res, next) => {
      const role = req.headers['x-test-role'];
      req.headers.authorization = 'Bearer test-token';
      if (!role) return next(new AppError('Missing Authorization bearer token', 401, 'UNAUTHORIZED'));
      req.user = {
        uid: `${role}-1`,
        permissions: { user: ['user:read'], admin: ['content:moderate', 'admin:all'] }[role],
      };
      return next();
    },
  };
});

const { createFakeFirestore } = require('./helpers/fakeFirestoreFull');
const { createCatalog, chunkOf } = require('../src/services/streaming/catalog');
const { createStreamingService } = require('../src/services/streaming/service');
const { syncShow } = require('../src/services/streaming/sync');
const { createYouTube, uploadsPlaylistId } = require('../src/services/streaming/youtube');
const { fillGaps, missingNumbers } = require('../src/services/streaming/gaps');
const { getShow } = require('../src/services/streaming/shows');
const { createStreamingRouters } = require('../src/routes/streaming');
const { errorHandler } = require('../src/middleware/errorHandler');

const show = getShow(8630);
const vidOf = (ch, n) => `${ch}${String(n).padStart(10, '0')}`; // 11 chars, unique per channel
const vid = (n) => vidOf('o', n);

/** Fake YouTube: each channel key has uploads [{n,title,seconds,region,...}]. */
function fakeYouTube(data) {
  const usage = { units: 0 };
  const byPlaylist = {};
  show.channels.forEach((c) => {
    byPlaylist[uploadsPlaylistId(c.id)] = data[c.key] || [];
  });
  Object.entries(data.playlists || {}).forEach(([id, list]) => {
    byPlaylist[id] = list;
  });
  const owner = {};
  show.channels.forEach((c) => (data[c.key] || []).forEach((u) => (owner[u.id] = c.id)));
  return {
    usage,
    async listUploads(pl, { max }) {
      usage.units += 1;
      return (byPlaylist[pl] || [])
        .slice(0, max)
        .map((u) => ({ videoId: u.id, title: u.title, publishedAt: '2026-10-01T00:00:00Z' }));
    },
    async videoDetails(ids) {
      usage.units += 1;
      const out = new Map();
      Object.values(byPlaylist)
        .flat()
        .filter((u) => ids.includes(u.id) && !u.gone)
        .forEach((u) =>
          out.set(u.id, {
            channelId: u.by || owner[u.id] || null,
            seconds: u.seconds ?? 1300,
            embeddable: u.embeddable !== false,
            privacy: 'public',
            ageRestricted: false,
            region: u.region ? (u.region.allowed ? { a: u.region.allowed } : { b: u.region.blocked }) : null, // same compact shape the real client returns
          })
        );
      return out;
    },
  };
}
const mk =
  (ch) =>
  (n, title, o = {}) => ({
    id: vidOf(ch, n),
    title: title || `FULL EPISODE ${n} - x | Taarak Mehta Ka Ooltah Chashmah`,
    ...o,
  });
const up = mk('o');
const upE = mk('e');
const upS = mk('s');
const upP = mk('p');

describe('catalog', () => {
  test('chunks hold 250 episodes; only changed chunks are written', async () => {
    expect([chunkOf(1), chunkOf(250), chunkOf(251)]).toEqual([0, 0, 1]);
    const db = createFakeFirestore();
    const cat = createCatalog(db);
    const a = new Map([
      [1, [{ v: 'a' }]],
      [300, [{ v: 'b' }]],
    ]);
    expect(await cat.saveEpisodes(8630, a)).toBe(2);
    const b = new Map(a);
    b.set(301, [{ v: 'c' }]);
    expect(await cat.saveEpisodes(8630, b, a)).toBe(1); // only chunk 1 changed
    const back = await cat.loadEpisodes(8630);
    expect([...back.keys()].sort((x, y) => x - y)).toEqual([1, 300, 301]);
  });
});

describe('meta', () => {
  test('a new lastSync replaces the old one instead of merging into it; blocked videos survive', async () => {
    const catalog = createCatalog(createFakeFirestore());
    await catalog.saveMeta(8630, {
      blockedVideos: ['aaaaaaaaaaa'],
      lastSync: { stoppedEarly: 'quota', channels: { official: { error: 'YOUTUBE_QUOTA' } } },
    });
    await catalog.saveMeta(8630, { lastSync: { channels: { official: { seen: 5, episodes: 2 } } } });
    const meta = await catalog.loadMeta(8630);
    expect(meta.lastSync).toEqual({ channels: { official: { seen: 5, episodes: 2 } } });
    expect(meta.blockedVideos).toEqual(['aaaaaaaaaaa']);
  });
});

describe('syncShow', () => {
  let db;
  let catalog;
  beforeEach(() => {
    db = createFakeFirestore();
    catalog = createCatalog(db);
  });

  const data = () => ({
    official: [
      up(1),
      up(2),
      up(3, 'Tapu ki Masti I FULL MOVIE | Taarak Mehta Ka Ooltah Chashmah Ep 01 - 05'),
      up(4, 'x | Taarak Mehta Ka Ooltah Chashmah', { seconds: 60 }),
    ],
    episodes: [upE(2, null, { region: { blocked: ['IN'] } }), upE(4800)],
    sab: [upS(2, null, { region: { allowed: ['IN'] } }), upS(10, 'Pushpa Impossible | Ep 10 | Full Episode')],
    pal: [
      upP(2000, 'Show | Taarak Mehta Ka Ooltah Chashmah | Episode 2000 | 5 July 2023', {
        region: { allowed: ['IN'] },
      }),
    ],
  });

  test('full sync builds the catalog from every channel and ignores non-episodes', async () => {
    const r = await syncShow({ show, mode: 'full', youtube: fakeYouTube(data()), catalog });
    const eps = await catalog.loadEpisodes(8630);
    expect([...eps.keys()].sort((a, b) => a - b)).toEqual([1, 2, 2000, 4800]);
    expect(eps.get(2).map((s) => s.c)).toEqual(['official', 'episodes', 'sab']); // priority order
    expect(r.videosByChannel).toEqual({ official: 2, episodes: 2, sab: 1, pal: 1 });
    expect(r.episodes).toBe(4);
    expect(r.latest).toBe(4800);
    expect((await catalog.loadMeta(8630)).lastSync.mode).toBe('full');
  });

  test('full sync also reads playlists: own-channel long episodes only', async () => {
    const sab = show.channels.find((c) => c.key === 'sab');
    const d = data();
    const own = upS(501, undefined, { by: sab.id });
    const clip = upS(502, undefined, { seconds: 200, by: sab.id });
    const foreign = upS(503, undefined, { by: 'UCsomeoneElse' });
    const preview = upS(504, 'Next Episode 504 Preview | Taarak Mehta Ka Ooltah Chashmah');
    const dup = d.sab[0];
    d.playlists = { [sab.playlists[0]]: [own, clip, foreign, preview, dup] };
    const r = await syncShow({ show, mode: 'full', youtube: fakeYouTube(d), catalog });
    const eps = await catalog.loadEpisodes(8630);
    expect(eps.get(501).map((s) => s.c)).toEqual(['sab']);
    [502, 503].forEach((n) => expect(eps.has(n)).toBe(false));
    expect(r.channels.sab.playlistVideos).toBeGreaterThan(0);
  });

  test('recent sync does not read playlists', async () => {
    const sab = show.channels.find((c) => c.key === 'sab');
    const d = data();
    d.playlists = { [sab.playlists[0]]: [upS(501)] };
    await syncShow({ show, mode: 'recent', youtube: fakeYouTube(d), catalog });
    expect((await catalog.loadEpisodes(8630)).has(501)).toBe(false);
  });

  test('recent sync adds new uploads without touching the rest', async () => {
    await syncShow({ show, mode: 'full', youtube: fakeYouTube(data()), catalog });
    const d = data();
    d.official.unshift(up(4801));
    const r = await syncShow({ show, mode: 'recent', youtube: fakeYouTube(d), catalog });
    const eps = await catalog.loadEpisodes(8630);
    expect(eps.has(4801)).toBe(true);
    expect(eps.has(2000)).toBe(true);
    expect(r.chunksWritten).toBe(1);
  });

  test('verify drops a deleted video and updates a changed region rule', async () => {
    await syncShow({ show, mode: 'full', youtube: fakeYouTube(data()), catalog });
    const d = data();
    d.official[0].gone = true; // episode 1 removed
    d.sab[0].region = { allowed: ['IN', 'PK'] };
    const r = await syncShow({ show, mode: 'verify', youtube: fakeYouTube(d), catalog });
    const eps = await catalog.loadEpisodes(8630);
    expect(eps.has(1)).toBe(false);
    expect(eps.get(2).find((s) => s.c === 'sab').r).toEqual({ a: ['IN', 'PK'] });
    expect(r.removedVideos).toBe(1);
    expect(r.regionUpdates).toBe(1);
  });

  test('a failing channel keeps its stored videos on a full rebuild', async () => {
    await syncShow({ show, mode: 'full', youtube: fakeYouTube(data()), catalog });
    const yt = fakeYouTube(data());
    const orig = yt.listUploads;
    yt.listUploads = async (pl, o) => {
      if (pl === uploadsPlaylistId(show.channels[3].id)) {
        const e = new Error('x');
        e.code = 'YOUTUBE_FAILED';
        throw e;
      }
      return orig(pl, o);
    };
    const r = await syncShow({ show, mode: 'full', youtube: yt, catalog });
    expect(r.channels.pal.error).toBe('YOUTUBE_FAILED');
    expect((await catalog.loadEpisodes(8630)).has(2000)).toBe(true);
  });

  test('quota exhaustion stops early and keeps stored data', async () => {
    await syncShow({ show, mode: 'full', youtube: fakeYouTube(data()), catalog });
    const yt = fakeYouTube(data());
    yt.listUploads = async () => {
      const e = new Error('q');
      e.code = 'YOUTUBE_QUOTA';
      throw e;
    };
    const r = await syncShow({ show, mode: 'full', youtube: yt, catalog });
    expect(r.stoppedEarly).toBe('quota');
    expect((await catalog.loadEpisodes(8630)).size).toBe(4);
  });
});

describe('service', () => {
  test('availability depends on the viewer country and never lists unplayable episodes', async () => {
    const db = createFakeFirestore();
    const catalog = createCatalog(db);
    await syncShow({
      show,
      mode: 'full',
      youtube: fakeYouTube({
        official: [up(1)],
        episodes: [upE(2, null, { region: { blocked: ['IN'] } })],
        sab: [upS(2, null, { region: { allowed: ['IN'] } })],
        pal: [upP(2000, 'Taarak Mehta Ka Ooltah Chashmah | Episode 2000', { region: { allowed: ['IN'] } })],
      }),
      catalog,
    });
    const svc = createStreamingService({ catalog });
    const india = await svc.availability(8630, 'in');
    const us = await svc.availability(8630, 'US');
    const unknown = await svc.availability(8630, undefined);
    expect(india.episodes.map((e) => e[0])).toEqual([1, 2, 2000]);
    expect(us.episodes.map((e) => e[0])).toEqual([1, 2]);
    expect(unknown.episodes.map((e) => e[0])).toEqual([1, 2]);
    expect(india.region).toBe('IN');
    expect(us.latest).toBe(2);
    await expect(svc.episode(8630, 2000, 'US')).rejects.toMatchObject({ code: 'EPISODE_NOT_AVAILABLE' });
    expect((await svc.episode(8630, 2, 'IN')).videoId).toBe(vidOf('s', 2)); // only Sony SAB plays it in India
    expect((await svc.episode(8630, 2, 'US')).videoId).toBe(vidOf('e', 2));
    await expect(svc.availability(999, 'IN')).rejects.toMatchObject({ code: 'STREAMING_NOT_FOUND' });
  });

  test('blocking a video hides it and falls back; report lists holes', async () => {
    const db = createFakeFirestore();
    const catalog = createCatalog(db);
    await syncShow({
      show,
      mode: 'full',
      youtube: fakeYouTube({ official: [up(1), up(5)], sab: [upS(5, null, {})] }),
      catalog,
    });
    const svc = createStreamingService({ catalog });
    expect((await svc.episode(8630, 5, 'IN')).fallbackVideoId).toBeTruthy();
    await svc.setBlocked(8630, vid(5), true); // official copy hidden: the Sony SAB copy takes over
    expect((await svc.episode(8630, 5, 'IN')).videoId).toBe(vidOf('s', 5));
    await svc.setBlocked(8630, vidOf('s', 5), true); // both hidden: the episode disappears
    expect((await svc.availability(8630, 'IN')).episodes.map((e) => e[0])).toEqual([1]);
    const rep = await svc.report(8630, 8);
    expect(rep.biggestHoles[0]).toBe('2-4 (3)');
    expect(rep.blockedVideos).toHaveLength(2);
    await svc.setBlocked(8630, vid(5), false);
    expect((await svc.availability(8630, 'IN')).episodes.map((e) => e[0])).toEqual([1, 5]);
  });
});

describe('routes', () => {
  const build = async () => {
    const db = createFakeFirestore();
    const catalog = createCatalog(db);
    const yt = fakeYouTube({ official: [up(1)], episodes: [upE(4800)] });
    const { publicRouter, adminRouter } = createStreamingRouters({ catalog, youtube: () => yt });
    const app = express();
    app.use(express.json());
    app.use('/streaming', publicRouter);
    app.use('/admin/streaming', adminRouter);
    app.use(errorHandler);
    return { app, catalog };
  };

  test('public availability needs no login, validates region, and is cacheable', async () => {
    const { app, catalog } = await build();
    await syncShow({ show, mode: 'full', youtube: fakeYouTube({ official: [up(1)] }), catalog });
    const res = await request(app).get('/streaming/shows/8630?region=in');
    expect(res.status).toBe(200);
    expect(res.body.data.episodes).toEqual([[1, vid(1), 0]]);
    expect(res.headers['cache-control']).toContain('max-age=300');
    expect((await request(app).get('/streaming/shows/8630?region=XYZ')).status).toBe(400);
    expect((await request(app).get('/streaming/shows/1')).status).toBe(404);
    expect((await request(app).get('/streaming/shows/8630/episodes/1?region=US')).body.data.videoId).toBe(
      vid(1)
    );
    expect((await request(app).get('/streaming/shows/8630/episodes/2')).status).toBe(404);
  });

  test('admin routes need the admin role', async () => {
    const { app } = await build();
    expect((await request(app).post('/admin/streaming/shows/8630/sync').send({})).status).toBe(401);
    expect(
      (await request(app).post('/admin/streaming/shows/8630/sync').set('x-test-role', 'user').send({})).status
    ).toBe(403);
    expect(
      (await request(app).get('/admin/streaming/shows/8630/report').set('x-test-role', 'user')).status
    ).toBe(403);
  });

  test('admin can sync (recent only), read the report and block a video', async () => {
    const { app } = await build();
    const sync = await request(app)
      .post('/admin/streaming/shows/8630/sync')
      .set('x-test-role', 'admin')
      .send({});
    expect(sync.status).toBe(200);
    expect(sync.body.data.episodes).toBe(2);
    expect(
      (
        await request(app)
          .post('/admin/streaming/shows/8630/sync')
          .set('x-test-role', 'admin')
          .send({ mode: 'full' })
      ).status
    ).toBe(400);
    const rep = await request(app)
      .get('/admin/streaming/shows/8630/report?total=5')
      .set('x-test-role', 'admin');
    expect(rep.body.data.episodesWithVideo).toBe(2);
    const blk = await request(app)
      .post('/admin/streaming/shows/8630/block')
      .set('x-test-role', 'admin')
      .send({ videoId: vid(1) });
    expect(blk.body.data.blockedVideos).toEqual([vid(1)]);
    expect(
      (
        await request(app)
          .post('/admin/streaming/shows/8630/block')
          .set('x-test-role', 'admin')
          .send({ videoId: 'nope' })
      ).status
    ).toBe(400);
  });
});

describe('show list', () => {
  const build = async (seed) => {
    const catalog = createCatalog(createFakeFirestore());
    await syncShow({ show, mode: 'full', youtube: fakeYouTube(seed), catalog });
    const { publicRouter } = createStreamingRouters({ catalog, youtube: () => fakeYouTube(seed) });
    const app = express();
    app.use('/streaming', publicRouter);
    app.use(errorHandler);
    return { app, catalog };
  };

  test('lists a show with the count this viewer can watch, and hides it when they can watch nothing', async () => {
    const { app } = await build({
      official: [up(1)],
      sab: [upS(2, null, { region: { allowed: ['IN'] } }), upS(3, null, { region: { allowed: ['IN'] } })],
    });
    const india = await request(app).get('/streaming/shows?region=IN');
    expect(india.status).toBe(200);
    expect(india.body.data.shows).toEqual([
      expect.objectContaining({
        tmdbId: 8630,
        season: 1,
        count: 3,
        latest: 3,
        title: 'Taarak Mehta Ka Ooltah Chashmah',
      }),
    ]);
    expect((await request(app).get('/streaming/shows?region=US')).body.data.shows[0].count).toBe(1);
    expect(india.headers['cache-control']).toContain('max-age=300');
    expect((await request(app).get('/streaming/shows?region=XYZ')).status).toBe(400);
  });

  test('a show with nothing synced yet is not listed', async () => {
    const { app } = await build({});
    expect((await request(app).get('/streaming/shows')).body.data.shows).toEqual([]);
  });
});

describe('YouTube client', () => {
  test('never leaks the API key, and reports quota clearly', async () => {
    const mk = (status, reason) => ({
      get: async (url) => {
        const e = new Error(`failed ${url}?key=SECRET-KEY-123`);
        e.response = { status, data: { error: { errors: [{ reason }] } } };
        throw e;
      },
    });
    const yt = createYouTube({ apiKey: 'SECRET-KEY-123', http: mk(500, 'backendError') });
    const err = await yt.listUploads('UUx', { max: 5 }).catch((e) => e);
    expect(err.code).toBe('YOUTUBE_FAILED');
    expect(JSON.stringify([err.message, err.details])).not.toContain('SECRET-KEY-123');
    const q = await createYouTube({ apiKey: 'k', http: mk(403, 'quotaExceeded') })
      .videoDetails(['a'])
      .catch((e) => e);
    expect(q.code).toBe('YOUTUBE_QUOTA');
    const none = await createYouTube({ apiKey: '' })
      .listUploads('UUx', { max: 5 })
      .catch((e) => e);
    expect(none.code).toBe('YOUTUBE_NOT_CONFIGURED');
  });

  test('pages through uploads and reads video details', async () => {
    const calls = [];
    const http = {
      get: async (url, { params }) => {
        calls.push([url.split('/').pop(), params.pageToken || null]);
        if (url.endsWith('playlistItems')) {
          const page2 = params.pageToken === 'p2';
          return {
            data: {
              items: [
                {
                  snippet: {
                    title: page2 ? 'b' : 'a',
                    resourceId: { videoId: page2 ? 'idB' : 'idA' },
                    publishedAt: '2026-01-01T00:00:00Z',
                  },
                },
              ],
              nextPageToken: page2 ? undefined : 'p2',
            },
          };
        }
        return {
          data: {
            items: [
              {
                id: 'idA',
                contentDetails: { duration: 'PT22M10S', regionRestriction: { allowed: ['IN'] } },
                status: { embeddable: true, privacyStatus: 'public' },
              },
            ],
          },
        };
      },
    };
    const yt = createYouTube({ apiKey: 'k', http });
    expect((await yt.listUploads('UUx', { max: 10 })).map((u) => u.videoId)).toEqual(['idA', 'idB']);
    const d = await yt.videoDetails(['idA', 'idB']);
    expect(d.get('idA')).toMatchObject({ seconds: 1330, region: { a: ['IN'] }, embeddable: true });
    expect(d.has('idB')).toBe(false);
    expect(yt.usage.units).toBe(3);
    expect(uploadsPlaylistId('UCnSFZ-olBoLGLRUS_3RI2Aw')).toBe('UUnSFZ-olBoLGLRUS_3RI2Aw');
  });
});

describe('real client + sync together (raw YouTube-shaped responses)', () => {
  test('region restrictions survive the whole chain and shape what each country sees', async () => {
    const videos = {
      okAll_____1: { title: 'FULL EPISODE 4800 - x | Taarak Mehta ka Ooltah Chasmah', region: undefined },
      onlyIndia__2: {
        title: 'Show | Taarak Mehta Ka Ooltah Chashmah | Full Episode 2000 | 5 July 2023',
        region: { allowed: ['IN'] },
      },
    };
    const http = {
      get: async (url, { params }) => {
        if (url.endsWith('playlistItems')) {
          const mine =
            params.playlistId === uploadsPlaylistId(show.channels[0].id)
              ? ['okAll_____1', 'onlyIndia__2']
              : [];
          return {
            data: {
              items: mine.map((id) => ({
                snippet: {
                  title: videos[id].title,
                  resourceId: { videoId: id },
                  publishedAt: '2026-10-01T00:00:00Z',
                },
              })),
            },
          };
        }
        return {
          data: {
            items: params.id.split(',').map((id) => ({
              id,
              contentDetails: { duration: 'PT21M', regionRestriction: videos[id].region },
              status: { embeddable: true, privacyStatus: 'public' },
            })),
          },
        };
      },
    };
    const catalog = createCatalog(createFakeFirestore());
    await syncShow({ show, mode: 'full', youtube: createYouTube({ apiKey: 'k', http }), catalog });
    const svc = createStreamingService({ catalog });
    expect((await svc.availability(8630, 'IN')).episodes.map((e) => e[0])).toEqual([2000, 4800]);
    expect((await svc.availability(8630, 'US')).episodes.map((e) => e[0])).toEqual([4800]);
  });
});

describe('gap search', () => {
  const sab = show.channels.find((c) => c.key === 'sab');
  const row = (n, o = {}) => ({
    videoId: `g${String(n).padStart(10, '0')}`,
    title: `FULL EPISODE ${n} | Taarak Mehta Ka Ooltah Chashmah`,
    channelId: sab.id,
    ...o,
  });
  const yt = (byQuery, details) => {
    const usage = { units: 0 };
    return {
      usage,
      async searchVideos(q) {
        usage.units += 100;
        return byQuery(q);
      },
      async videoDetails(ids) {
        usage.units += 1;
        return new Map(ids.map((id) => [id, { seconds: 1300, embeddable: true, privacy: 'public', ...details }]));
      },
    };
  };

  test('lists missing numbers', () => {
    expect(missingNumbers(new Map([[2, []]]), 4)).toEqual([1, 3, 4]);
  });

  test('adds a found episode, explains the ones it cannot, and respects the limit', async () => {
    const youtube = yt((q) =>
      q.endsWith('Episode 501')
        ? [row(501), row(501, { videoId: 'foreign0001', channelId: 'UCother' })]
        : q.endsWith('Episode 502')
          ? [row(502, { title: 'Taarak Mehta Ka Ooltah Chashmah | Episode 9 clip' })]
          : []
    );
    const r = await fillGaps({ show, youtube, missing: [501, 502, 503, 504], limit: 3 });
    expect(r.added.get(501).map((s) => s.c)).toEqual(['sab']);
    expect(r.added.get(501)).toHaveLength(1);
    expect(r.why[502]).toMatch(/title says episode 9/);
    expect(r.why[503]).toBe('no results');
    expect(r.tried).toEqual([501, 502, 503]);
  });

  test('stops at the unit budget', async () => {
    const r = await fillGaps({ show, youtube: yt(() => []), missing: [1, 2, 3], maxUnits: 200 });
    expect(r.tried).toEqual([1, 2]);
    expect(r.stoppedEarly).toBe('maxUnits');
  });
});
