'use strict';

jest.mock(
  '../src/utils/errors',
  () => ({
    AppError: class AppError extends Error {
      constructor(m, status, code) {
        super(m);
        this.status = status;
        this.code = code;
      }
    },
  }),
  { virtual: true }
);

const { createDiscoverPicks, MAX_PICKS, NOTE_MAX } = require('../src/services/discoverPicks');

// minimal in-memory Firestore: collection get, doc get/set/update/delete, batch update
function fakeDb() {
  const store = new Map();
  const ref = (id) => ({
    id,
    async get() {
      return { id, exists: store.has(id), data: () => ({ ...store.get(id) }) };
    },
    async set(d) {
      store.set(id, { ...d });
    },
    async update(d) {
      store.set(id, { ...store.get(id), ...d });
    },
    async delete() {
      store.delete(id);
    },
  });
  return {
    store,
    collection: () => ({
      async get() {
        const docs = [...store.entries()].map(([id, d]) => ({ id, data: () => ({ ...d }) }));
        return { forEach: (fn) => docs.forEach(fn) };
      },
      doc: ref,
    }),
    batch() {
      const ops = [];
      return {
        update: (r, d) => ops.push(() => r.update(d)),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
}

let picks;
let db;
let n;
beforeEach(() => {
  db = fakeDb();
  n = 0;
  picks = createDiscoverPicks({ getDb: () => db, now: () => `2026-11-27T10:00:${String(n++).padStart(2, '0')}.000Z` });
});

const movie = (id, extra) => ({ type: 'movie', tmdbId: id, title: `M${id}`, posterPath: `/p${id}.jpg`, year: '1999', ...extra });

describe('discover picks', () => {
  test('adds in order, with a trimmed note, and lists them', async () => {
    await picks.add(movie(1, { note: '  Watch   this\n one  ' }));
    await picks.add({ type: 'tv', tmdbId: 2, title: 'Show', posterPath: '/s.jpg' });
    const rows = await picks.list();
    expect(rows.map((r) => r.id)).toEqual(['movie-1', 'tv-2']);
    expect(rows[0].note).toBe('Watch this one');
    expect(rows[1].order).toBe(2);
  });

  test('rejects duplicates, bad input, and a full list', async () => {
    await picks.add(movie(1));
    await expect(picks.add(movie(1))).rejects.toMatchObject({ status: 409 });
    await expect(picks.add({ ...movie(2), type: 'person' })).rejects.toMatchObject({ status: 400 });
    await expect(picks.add({ ...movie(2), title: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(picks.add({ ...movie(0) })).rejects.toMatchObject({ status: 400 });
    for (let i = 10; i < 10 + MAX_PICKS - 1; i++) await picks.add(movie(i));
    await expect(picks.add(movie(999))).rejects.toMatchObject({ status: 400, code: 'LIMIT_REACHED' });
  });

  test('note is capped; a bad poster path is dropped', async () => {
    const r = await picks.add(movie(1, { note: 'x'.repeat(500), posterPath: 'https://evil/x.jpg' }));
    expect(r.note).toHaveLength(NOTE_MAX);
    expect(r.posterPath).toBeNull();
  });

  test('edits a note and removes a pick; unknown ids are 404', async () => {
    await picks.add(movie(1));
    expect((await picks.setNote('movie-1', ' great ')).note).toBe('great');
    await picks.remove('movie-1');
    expect(await picks.list()).toEqual([]);
    await expect(picks.setNote('movie-1', 'x')).rejects.toMatchObject({ status: 404 });
    await expect(picks.remove('movie-1')).rejects.toMatchObject({ status: 404 });
  });

  test('reorders; picks not mentioned follow in their old order; unknown id fails', async () => {
    for (const i of [1, 2, 3, 4]) await picks.add(movie(i));
    await picks.reorder(['movie-3', 'movie-1']);
    expect((await picks.list()).map((r) => r.id)).toEqual(['movie-3', 'movie-1', 'movie-2', 'movie-4']);
    await expect(picks.reorder(['movie-9'])).rejects.toMatchObject({ status: 404 });
  });

  test('public items: by type, app item shape, poster url, in order', async () => {
    await picks.add(movie(1, { note: 'Classic' }));
    await picks.add({ type: 'tv', tmdbId: 2, title: 'Show', posterPath: '/s.jpg' });
    await picks.add({ type: 'movie', tmdbId: 3, title: 'No poster' });
    await picks.add(movie(4));
    const movies = await picks.publicItems('movie');
    expect(movies.map((i) => i.imdbID)).toEqual(['tmdb:movie:1', 'tmdb:movie:4']);
    expect(movies[0]).toMatchObject({ Title: 'M1', Type: 'movie', Year: '1999', note: 'Classic', Poster: 'https://image.tmdb.org/t/p/w342/p1.jpg' });
    expect((await picks.publicItems('tv'))[0]).toMatchObject({ imdbID: 'tmdb:tv:2', Type: 'series' });
  });
});
