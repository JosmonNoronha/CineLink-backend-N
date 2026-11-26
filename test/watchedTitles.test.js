'use strict';

const { createFakeFirestore, DEL, TS } = require('./helpers/fakeFirestore');

let mockDb;
jest.mock('firebase-admin', () => {
  const h = require('./helpers/fakeFirestore');
  return {
    firestore: {
      FieldValue: { serverTimestamp: () => h.TS, delete: () => h.DEL },
      Timestamp: { now: () => ({ _seconds: 1700000000, toDate: () => new Date(1700000000000) }) },
    },
  };
}, { virtual: true });
jest.mock('../src/config/firebase', () => ({ getFirestore: () => mockDb }), { virtual: true });
jest.mock(
  '../src/utils/errors',
  () => ({
    AppError: class AppError extends Error {
      constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
      }
    },
  }),
  { virtual: true }
);

const watched = require('../src/services/user/watchedTitles');
const gamification = require('../src/services/user/gamification');

const UID = 'u1';
const user = () => mockDb.collection('users').doc(UID);
const titleDoc = (id) => user().collection('watched').doc(id).get();

const TOTALS = { totalSeasons: 2, totalEpisodes: 5, seasonCounts: { 1: 3, 2: 2 } };
let totalsCalls;
beforeEach(() => {
  mockDb = createFakeFirestore();
  totalsCalls = [];
  watched.setTotalsProvider({
    get: async (id) => {
      totalsCalls.push(id);
      return id === '1' || id === '77' ? TOTALS : null;
    },
  });
});

async function seedList(name, movies) {
  await user().collection('watchlists').doc(name).set({ movies });
}

describe('movies', () => {
  test('can be marked watched with no watchlist at all', async () => {
    const res = await watched.setTitleWatched(UID, 'tmdb:movie:603', {
      type: 'movie',
      watched: true,
      meta: { title: 'The Matrix', poster: '/m.jpg', year: '1999' },
    });
    expect(res.watched).toBe(true);
    const list = await watched.listWatchedTitles(UID);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ contentId: 'tmdb:movie:603', type: 'movie', title: 'The Matrix', status: 'completed' });
    expect(list.counts).toEqual({ movies: 1, series: 0, inProgress: 0 });
  });

  test('can be un-marked', async () => {
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: true, meta: { title: 'The Matrix' } });
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: false });
    expect((await watched.listWatchedTitles(UID)).items).toHaveLength(0);
  });

  test('marking watched also ticks it in every watchlist that holds it', async () => {
    await seedList('A', [{ imdbID: 'tmdb:603', tmdb_id: 603, media_type: 'movie', watched: false }]);
    await seedList('B', [{ imdbID: 'tmdb:604', tmdb_id: 604, media_type: 'movie', watched: false }]);
    const res = await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: true });
    expect(res.listsUpdated).toBe(1);
    const a = await user().collection('watchlists').doc('A').get();
    const b = await user().collection('watchlists').doc('B').get();
    expect(a.data().movies[0].watched).toBe(true);
    expect(b.data().movies[0].watched).toBe(false);
  });

  test('a tv item with the same tmdb id is not touched by a movie', async () => {
    await seedList('A', [{ imdbID: 'tmdb:603', tmdb_id: 603, media_type: 'tv', watched: false }]);
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: true });
    const a = await user().collection('watchlists').doc('A').get();
    expect(a.data().movies[0].watched).toBe(false);
  });
});

describe('series', () => {
  const meta = { title: 'Lost', totalEpisodes: 4, totalSeasons: 2, seasonCounts: { 1: 2, 2: 2 } };
  const tick = async (s, e, w = true) => {
    const ref = user().collection('watched').doc('tmdb:tv:1');
    // mimic the existing episodes service
    await ref.set({ [`s${s}e${e}`]: w ? { watchedAt: '2026-02-0' + (e + 1) + 'T00:00:00Z', season: s, episode: e } : DEL, updatedAt: TS }, { merge: true });
    return watched.afterEpisodeChange(UID, 'tmdb:tv:1', { watched: w, meta });
  };

  test('shows as in progress with episode and season counts', async () => {
    await tick(1, 1);
    await tick(1, 2);
    await tick(2, 1);
    const { items, counts } = await watched.listWatchedTitles(UID);
    expect(items[0]).toMatchObject({
      type: 'series',
      status: 'inProgress',
      episodesWatched: 3,
      totalEpisodes: 4,
      completedSeasons: 1,
      lastEpisode: { season: 2, episode: 1 },
    });
    expect(items[0].progress).toBeCloseTo(0.75);
    expect(counts.inProgress).toBe(1);
  });

  test('completes by itself when the last episode is ticked, once', async () => {
    await tick(1, 1);
    await tick(1, 2);
    await tick(2, 1);
    const last = await tick(2, 2);
    expect(last.justCompleted).toBe(true);
    expect(last.summary.status).toBe('completed');
    expect(last.summary.progress).toBe(1);
    const again = await tick(2, 2);
    expect(again.justCompleted).toBe(false);
  });

  test('un-ticking an episode of a finished series reopens it', async () => {
    await watched.setTitleWatched(UID, 'tmdb:tv:1', {
      type: 'series',
      watched: true,
      meta,
      episodes: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 2, episode: 1 }, { season: 2, episode: 2 }],
    });
    expect((await watched.getTitleState(UID, 'tmdb:tv:1')).watched).toBe(true);
    const r = await tick(2, 2, false);
    expect(r.summary.status).toBe('inProgress');
    expect(r.summary.episodesWatched).toBe(3);
  });

  test('marking the whole series ticks every episode; un-marking clears them', async () => {
    const eps = [{ season: 1, episode: 1 }, { season: 1, episode: 2 }];
    const res = await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' }, episodes: eps });
    expect(res.summary).toMatchObject({ status: 'completed', episodesWatched: 2 });
    const off = await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: false });
    expect(off.summary).toBeNull();
    const doc = await titleDoc('tmdb:tv:1');
    expect(Object.keys(doc.data()).filter((k) => /^s\d+e\d+$/.test(k))).toHaveLength(0);
  });

  test('a series with unknown total stays in progress until marked', async () => {
    const ref = user().collection('watched').doc('tmdb:tv:9');
    await ref.set({ s1e1: { watchedAt: '2026-02-01T00:00:00Z', season: 1, episode: 1 } }, { merge: true });
    const { items } = await watched.listWatchedTitles(UID);
    expect(items[0]).toMatchObject({ status: 'inProgress', progress: null, totalEpisodes: null });
  });

  test('episode ticks from an older app version (no kind, no title) still show as a series', async () => {
    const ref = user().collection('watched').doc('tmdb:tv:77');
    await ref.set({ s1e1: { watchedAt: '2026-02-01T00:00:00Z', season: 1, episode: 1 } }, { merge: true });
    const { items } = await watched.listWatchedTitles(UID);
    expect(items[0]).toMatchObject({ contentId: 'tmdb:tv:77', type: 'series', status: 'inProgress', title: null });
  });

  test('free-show ticks on a non-title id are not listed', async () => {
    const ref = user().collection('watched').doc('freeshow-1');
    await ref.set({ s1e1: { watchedAt: '2026-02-01T00:00:00Z', season: 1, episode: 1 } }, { merge: true });
    expect((await watched.listWatchedTitles(UID)).items).toHaveLength(0);
  });

  test('rejects oversized bulk marks', async () => {
    const eps = Array.from({ length: watched.MAX_BULK_EPISODES + 1 }, (_, i) => ({ season: 1, episode: i + 1 }));
    await expect(watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, episodes: eps })).rejects.toMatchObject({ status: 413 });
  });
});

describe('migration and list mirroring', () => {
  test('existing watched list items are imported once, never overwriting', async () => {
    await seedList('A', [
      { imdbID: 'tmdb:603', tmdb_id: 603, media_type: 'movie', Title: 'The Matrix', Poster: '/m.jpg', Year: '1999', watched: true, watchedAt: '2025-05-05T00:00:00.000Z' },
      { imdbID: 'tmdb:10', tmdb_id: 10, media_type: 'movie', Title: 'Unwatched', watched: false },
      { imdbID: 'tt0111161', Title: 'Shawshank', watched: true },
    ]);
    const first = await watched.listWatchedTitles(UID);
    expect(first.items.map((i) => i.contentId).sort()).toEqual(['tmdb:movie:603', 'tt0111161']);
    expect(first.items.find((i) => i.contentId === 'tmdb:movie:603').title).toBe('The Matrix');

    // user un-marks it, later list data changes: migration must not run again
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: false });
    await seedList('A', [{ imdbID: 'tmdb:603', tmdb_id: 603, media_type: 'movie', Title: 'The Matrix', watched: true }]);
    const second = await watched.listWatchedTitles(UID);
    expect(second.items.map((i) => i.contentId)).not.toContain('tmdb:movie:603');
  });

  test('a watchlist toggle is mirrored into the title record', async () => {
    await seedList('A', [{ imdbID: 'tmdb:603', tmdb_id: 603, media_type: 'movie', Title: 'The Matrix', watched: true }]);
    await watched.listWatchedTitles(UID); // run migration first
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: false });
    await seedList('A', [{ imdbID: 'tmdb:603', tmdb_id: 603, media_type: 'movie', Title: 'The Matrix', watched: true }]);
    await watched.mirrorListToggle(UID, 'A', 603, true);
    expect((await watched.listWatchedTitles(UID)).items.map((i) => i.contentId)).toContain('tmdb:movie:603');
  });
});

describe('XP without a watchlist', () => {
  test('awards once per title, and not for a title that is not watched', async () => {
    await expect(gamification.recordWatchTitle(UID, 'tmdb:movie:603', { idempotencyKey: 'k0' })).rejects.toMatchObject({ code: 'WATCH_NOT_ELIGIBLE' });

    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: true });
    const first = await gamification.recordWatchTitle(UID, 'tmdb:movie:603', { idempotencyKey: 'k1' });
    expect(first.xpGained).toBeGreaterThanOrEqual(25);

    // un-mark and re-mark: no second payout
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: false });
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: true });
    const second = await gamification.recordWatchTitle(UID, 'tmdb:movie:603', { idempotencyKey: 'k2' });
    expect(second.xpGained).toBe(0);
    expect(second.alreadyRewarded).toBe(true);
  });

  test('a title already rewarded through a watchlist ("tmdb:603") is not paid twice', async () => {
    await user().set({ gamification: { watchedMovieIds: ['tmdb:603'], totalWatched: 1, xp: 25 } }, { merge: true });
    await watched.setTitleWatched(UID, 'tmdb:movie:603', { type: 'movie', watched: true });
    const r = await gamification.recordWatchTitle(UID, 'tmdb:movie:603', { idempotencyKey: 'k3' });
    expect(r.xpGained).toBe(0);
  });
});

describe('episode totals from TMDB', () => {
  test('marking a series watched needs no episode list from the app', async () => {
    const res = await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    expect(res.summary).toMatchObject({ status: 'completed', episodesWatched: 5, totalEpisodes: 5, totalSeasons: 2 });
  });

  test('the first episode tick stores the totals, so progress shows straight away', async () => {
    const ref = user().collection('watched').doc('tmdb:tv:1');
    await ref.set({ s1e1: { watchedAt: '2026-02-01T00:00:00Z', season: 1, episode: 1 } }, { merge: true });
    const r = await watched.afterEpisodeChange(UID, 'tmdb:tv:1', { watched: true, meta: { title: 'Lost' } });
    expect(r.summary).toMatchObject({ status: 'inProgress', totalEpisodes: 5, completedSeasons: 0 });
    expect(r.summary.progress).toBeCloseTo(0.2);
  });

  test('older records without totals are filled in when the list loads, once', async () => {
    const ref = user().collection('watched').doc('tmdb:tv:77');
    await ref.set({ kind: 'series', meta: { title: 'Old' }, s1e1: { watchedAt: '2026-02-01T00:00:00Z', season: 1, episode: 1 } }, { merge: true });
    const first = await watched.listWatchedTitles(UID);
    expect(first.items[0]).toMatchObject({ totalEpisodes: 5, totalSeasons: 2 });
    await watched.listWatchedTitles(UID);
    expect(totalsCalls).toEqual(['77']);
  });

  test('the app still works when TMDB is unavailable', async () => {
    watched.setTotalsProvider({ get: async () => { throw new Error('down'); } });
    const res = await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    expect(res.summary.status).toBe('completed'); // flag only, no episode ticks
    expect(res.summary.episodesWatched).toBe(0);
  });

  test('a client-supplied episode list wins over the server one', async () => {
    const res = await watched.setTitleWatched(UID, 'tmdb:tv:1', {
      type: 'series', watched: true, meta: { title: 'Lost' }, episodes: [{ season: 1, episode: 1 }],
    });
    expect(res.summary.episodesWatched).toBe(1);
  });
});

describe('un-checking a series in a watchlist', () => {
  const seed = async (tick) => {
    await user().collection('watched').doc('tmdb:tv:1').set({ kind: 'series', meta: { title: 'Lost', totalEpisodes: 3, totalsAt: new Date().toISOString() }, watched: true, ...tick }, { merge: true });
    await seedList('A', [{ imdbID: 'tmdb:1', tmdb_id: 1, media_type: 'tv', Title: 'Lost', watched: false }]);
  };
  const ep = (e) => ({ [`s1e${e}`]: { watchedAt: '2026-02-01T00:00:00Z', season: 1, episode: e } });

  test('a series that is finished by its ticks is really un-finished', async () => {
    await seed({ ...ep(1), ...ep(2), ...ep(3) });
    await watched.mirrorListToggle(UID, 'A', 1, false);
    const s = (await watched.getTitleState(UID, 'tmdb:tv:1')).summary;
    expect(s).toBeNull();
  });

  test('a partly watched series keeps its progress', async () => {
    await seed({ ...ep(1) });
    await watched.mirrorListToggle(UID, 'A', 1, false);
    const s = (await watched.getTitleState(UID, 'tmdb:tv:1')).summary;
    expect(s).toMatchObject({ status: 'inProgress', episodesWatched: 1 });
  });
});

describe('a finished series reopens when more episodes air', () => {
  const setTotals = (counts) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    watched.setTotalsProvider({ get: async () => ({ totalSeasons: Object.keys(counts).length, totalEpisodes: total, seasonCounts: counts }) });
  };
  const age = async (id) => {
    const ref = user().collection('watched').doc(id);
    const d = (await ref.get()).data();
    await ref.set({ meta: { ...d.meta, totalsAt: '2020-01-01T00:00:00.000Z' } }, { merge: true });
  };

  test('finished by episodes -> reopens when the count grows, and un-ticks it in lists', async () => {
    setTotals({ 1: 3, 2: 2 });
    await seedList('A', [{ imdbID: 'tmdb:1', tmdb_id: 1, media_type: 'tv', Title: 'Lost', watched: false }]);
    await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    expect((await watched.getTitleState(UID, 'tmdb:tv:1')).watched).toBe(true);
    expect((await user().collection('watchlists').doc('A').get()).data().movies[0].watched).toBe(true);

    setTotals({ 1: 3, 2: 2, 3: 4 }); // a new season airs
    await age('tmdb:tv:1');
    const { items } = await watched.listWatchedTitles(UID);
    expect(items[0]).toMatchObject({ status: 'inProgress', episodesWatched: 5, totalEpisodes: 9, totalSeasons: 3 });
    expect((await user().collection('watchlists').doc('A').get()).data().movies[0].watched).toBe(false);
  });

  test('opening the title (Details) also notices the new episodes', async () => {
    setTotals({ 1: 2 });
    await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    setTotals({ 1: 3 });
    await age('tmdb:tv:1');
    const st = await watched.getTitleState(UID, 'tmdb:tv:1');
    expect(st.watched).toBe(false);
    expect(st.summary.status).toBe('inProgress');
  });

  test('then finishing the new episodes completes it again, once', async () => {
    setTotals({ 1: 2 });
    await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    setTotals({ 1: 3 });
    await age('tmdb:tv:1');
    await watched.listWatchedTitles(UID);
    const ref = user().collection('watched').doc('tmdb:tv:1');
    await ref.set({ s1e3: { watchedAt: '2026-03-01T00:00:00Z', season: 1, episode: 3 } }, { merge: true });
    const r = await watched.afterEpisodeChange(UID, 'tmdb:tv:1', { watched: true });
    expect(r).toMatchObject({ completed: true, justCompleted: true });
  });

  test('one marked watched without episode ticks is never reopened', async () => {
    watched.setTotalsProvider({ get: async () => null }); // TMDB unavailable when marking
    await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    setTotals({ 1: 3 });
    await age('tmdb:tv:1').catch(() => {});
    await watched.listWatchedTitles(UID);
    expect((await watched.getTitleState(UID, 'tmdb:tv:1')).watched).toBe(true);
  });

  test('a series checked by hand in a watchlist is never reopened', async () => {
    await seedList('A', [{ imdbID: 'tmdb:1', tmdb_id: 1, media_type: 'tv', Title: 'Lost', watched: true }]);
    await watched.listWatchedTitles(UID); // migration imports it
    setTotals({ 1: 3 });
    await watched.listWatchedTitles(UID);
    expect((await watched.getTitleState(UID, 'tmdb:tv:1')).watched).toBe(true);
  });
});

describe('un-ticking an episode of a finished series', () => {
  test('also un-checks the series in every watchlist', async () => {
    await seedList('A', [{ imdbID: 'tmdb:1', tmdb_id: 1, media_type: 'tv', Title: 'Lost', watched: false }]);
    await seedList('B', [{ imdbID: 'tmdb:1', tmdb_id: 1, media_type: 'tv', Title: 'Lost', watched: false }]);
    await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    for (const n of ['A', 'B']) expect((await user().collection('watchlists').doc(n).get()).data().movies[0].watched).toBe(true);

    const ref = user().collection('watched').doc('tmdb:tv:1');
    await ref.set({ s2e2: DEL }, { merge: true }); // what the episode route does
    const r = await watched.afterEpisodeChange(UID, 'tmdb:tv:1', { watched: false });

    expect(r.completed).toBe(false);
    for (const n of ['A', 'B']) expect((await user().collection('watchlists').doc(n).get()).data().movies[0].watched).toBe(false);
  });

  test('ticking the episode again re-checks it in the watchlists', async () => {
    await seedList('A', [{ imdbID: 'tmdb:1', tmdb_id: 1, media_type: 'tv', Title: 'Lost', watched: false }]);
    await watched.setTitleWatched(UID, 'tmdb:tv:1', { type: 'series', watched: true, meta: { title: 'Lost' } });
    const ref = user().collection('watched').doc('tmdb:tv:1');
    await ref.set({ s2e2: DEL }, { merge: true });
    await watched.afterEpisodeChange(UID, 'tmdb:tv:1', { watched: false });
    await ref.set({ s2e2: { watchedAt: '2026-03-01T00:00:00Z', season: 2, episode: 2 } }, { merge: true });
    const r = await watched.afterEpisodeChange(UID, 'tmdb:tv:1', { watched: true });
    expect(r.justCompleted).toBe(true);
    expect((await user().collection('watchlists').doc('A').get()).data().movies[0].watched).toBe(true);
  });
});
