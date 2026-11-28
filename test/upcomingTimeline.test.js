'use strict';

const mockTmdbGet = jest.fn();
const mockCache = new Map();

jest.mock('../src/services/tmdb/client', () => ({ tmdbGet: (...a) => mockTmdbGet(...a) }), { virtual: true });
jest.mock(
  '../src/services/tmdb/cache',
  () => ({
    cacheGet: async (k) => mockCache.get(k) || null,
    cacheSet: async (k, v) => void mockCache.set(k, v),
  }),
  { virtual: true }
);
jest.mock(
  '../src/services/tmdb/compat',
  () => ({
    searchByGenreOmdbLike: async ({ genreResults }) => ({
      Search: genreResults.results.map((r) => ({
        Title: r.title || r.name,
        Year: String(r.release_date || r.first_air_date || '').slice(0, 4),
        imdbID: `tmdb:${r.media_type}:${r.id}`,
        Type: r.media_type === 'tv' ? 'series' : 'movie',
        Poster: `https://img/${r.poster_path}`,
        imdbRating: 'N/A',
        _isGenreSearch: true,
      })),
    }),
  }),
  { virtual: true }
);

const { getUpcomingTimeline, MAX_ITEMS } = require('../src/services/tmdb/upcomingTimeline');

const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const mv = (id, d, extra) => ({ id, title: `M${id}`, poster_path: `/${id}`, release_date: iso(d), overview: 'o', ...extra });
const tv = (id, d, extra) => ({ id, name: `T${id}`, poster_path: `/${id}`, first_air_date: iso(d), overview: 'o', ...extra });

function mockTmdb({ movies = [], shows = [] }) {
  mockTmdbGet.mockImplementation(async (path, params) => {
    const list = path === '/movie/upcoming' ? movies : shows;
    return { results: params.page === 1 ? list : [] };
  });
}

beforeEach(() => {
  mockCache.clear();
  mockTmdbGet.mockReset();
});

describe('upcoming timeline', () => {
  test('merges movies and series into one list sorted by date, soonest first', async () => {
    mockTmdb({ movies: [mv(1, 10), mv(2, 1)], shows: [tv(3, 5), tv(4, 0)] });
    const out = await getUpcomingTimeline({ region: 'in' });
    expect(out.region).toBe('IN');
    expect(out.items.map((i) => i.imdbID)).toEqual(['tmdb:tv:4', 'tmdb:movie:2', 'tmdb:tv:3', 'tmdb:movie:1']);
    expect(out.items[0]).toMatchObject({ Type: 'series', releaseDate: iso(0), overview: 'o' });
  });

  test('same day: most popular first', async () => {
    mockTmdb({ movies: [mv(1, 3, { popularity: 5 })], shows: [tv(2, 3, { popularity: 50 })] });
    const out = await getUpcomingTimeline({});
    expect(out.items.map((i) => i.imdbID)).toEqual(['tmdb:tv:2', 'tmdb:movie:1']);
  });

  test('drops past, poster-less and duplicate titles', async () => {
    mockTmdb({ movies: [mv(1, -3), mv(2, 4, { poster_path: null }), mv(3, 4), mv(3, 4)], shows: [] });
    const out = await getUpcomingTimeline({});
    expect(out.items.map((i) => i.imdbID)).toEqual(['tmdb:movie:3']);
  });

  test('region goes to movies only; series use a date window', async () => {
    mockTmdb({});
    await getUpcomingTimeline({ region: 'IN' });
    const movieCall = mockTmdbGet.mock.calls.find((c) => c[0] === '/movie/upcoming');
    const tvCall = mockTmdbGet.mock.calls.find((c) => c[0] === '/discover/tv');
    expect(movieCall[1].region).toBe('IN');
    expect(tvCall[1].region).toBeUndefined();
    expect(tvCall[1]['first_air_date.gte']).toBe(iso(0));
    expect(tvCall[1]['first_air_date.lte']).toBe(iso(180));
  });

  test('caps the list, caches per region, and a failing first page fails', async () => {
    mockTmdb({ movies: Array.from({ length: 200 }, (_, i) => mv(i + 1, 2)) });
    expect((await getUpcomingTimeline({ region: 'IN' })).items).toHaveLength(MAX_ITEMS);
    const calls = mockTmdbGet.mock.calls.length;
    await getUpcomingTimeline({ region: 'IN' });
    expect(mockTmdbGet.mock.calls.length).toBe(calls);

    mockCache.clear();
    mockTmdbGet.mockReset().mockImplementation(async (path) => {
      if (path === '/movie/upcoming') throw new Error('down');
      return { results: [] };
    });
    await expect(getUpcomingTimeline({ region: 'US' })).rejects.toThrow('down');
  });
});
