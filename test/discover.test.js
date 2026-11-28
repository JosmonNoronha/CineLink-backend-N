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
    // same shape as the real searchByGenreOmdbLike
    searchByGenreOmdbLike: async ({ genreResults }) => ({
      Search: genreResults.results.map((r) => ({
        Title: r.title || r.name,
        Year: String(r.release_date || r.first_air_date || '').slice(0, 4) || 'N/A',
        imdbID: `tmdb:${r.media_type}:${r.id}`,
        Type: r.media_type === 'tv' ? 'series' : 'movie',
        Poster: `https://img/${r.poster_path}`,
        Genre: '',
        imdbRating: r.vote_average > 0 ? r.vote_average.toFixed(1) : 'N/A',
        _tmdbId: r.id,
        _isGenreSearch: true,
      })),
    }),
  }),
  { virtual: true }
);
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

jest.mock('../src/services/discoverPicks', () => ({ publicItems: async (type) => [{ Title: `pick-${type}`, imdbID: `tmdb:${type}:1`, note: 'n' }] }), { virtual: true });

const { getFeed, getCalendar, getMyShowsCalendar, FEEDS, FEED_IDS, MAX_PAGES } = require('../src/services/tmdb/discover');

const page = (n = 2) => ({
  page: 1,
  total_pages: 9,
  results: [
    { id: 1, title: 'A', poster_path: '/a.jpg', release_date: '2026-11-21', vote_average: 7.46, overview: 'x'.repeat(400) },
    { id: 2, title: 'No poster', poster_path: null, release_date: '2026-11-01' },
    { id: 3, title: 'B', poster_path: '/b.jpg', release_date: '2026-10-30', vote_average: 0 },
  ].slice(0, n + 1),
});

beforeEach(() => {
  mockCache.clear();
  mockTmdbGet.mockReset().mockResolvedValue(page());
});

describe('in-theaters feed', () => {
  test('asks TMDB for now_playing in the region, and returns app-ready items', async () => {
    const out = await getFeed({ feed: 'in-theaters', type: 'movie', region: 'in', page: 1 });
    expect(mockTmdbGet).toHaveBeenCalledWith('/movie/now_playing', { language: 'en-US', page: 1, region: 'IN' });
    expect(out).toMatchObject({ feed: 'in-theaters', type: 'movie', region: 'IN', page: 1 });
    expect(out.items.map((i) => i.imdbID)).toEqual(['tmdb:movie:1', 'tmdb:movie:3']); // poster-less title dropped
    expect(out.items[0]).toMatchObject({ Title: 'A', Type: 'movie', releaseDate: '2026-11-21', imdbRating: '7.5' });
    expect(out.items[0].overview.length).toBeLessThanOrEqual(180);
    expect(out.items[0]._isGenreSearch).toBeUndefined();
  });

  test('is cached per feed, type, region and page', async () => {
    await getFeed({ feed: 'in-theaters', region: 'IN' });
    await getFeed({ feed: 'in-theaters', region: 'IN' });
    expect(mockTmdbGet).toHaveBeenCalledTimes(1);
    await getFeed({ feed: 'in-theaters', region: 'US' });
    await getFeed({ feed: 'in-theaters', region: 'IN', page: 2 });
    expect(mockTmdbGet).toHaveBeenCalledTimes(3);
  });

  test('caps pages and reports total pages', async () => {
    const out = await getFeed({ feed: 'in-theaters', region: 'IN', page: 99 });
    expect(mockTmdbGet).toHaveBeenCalledWith('/movie/now_playing', expect.objectContaining({ page: MAX_PAGES }));
    expect(out.totalPages).toBe(MAX_PAGES);
  });

  test('rejects an unknown feed and an unsupported type', async () => {
    await expect(getFeed({ feed: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(getFeed({ feed: 'in-theaters', type: 'tv' })).rejects.toMatchObject({ status: 400 });
  });

  test('a TMDB failure is not cached', async () => {
    mockTmdbGet.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 502 }));
    await expect(getFeed({ feed: 'in-theaters', region: 'IN' })).rejects.toThrow('down');
    await expect(getFeed({ feed: 'in-theaters', region: 'IN' })).resolves.toMatchObject({ items: expect.any(Array) });
  });

  test('every feed declares a ttl and at least one type', () => {
    for (const id of FEED_IDS) {
      expect(FEEDS[id].ttl).toBeGreaterThan(0);
      expect(Object.keys(FEEDS[id].types).length).toBeGreaterThan(0);
    }
  });

  describe('upcoming', () => {
    const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
    const raw = {
      total_pages: 3,
      results: [
        { id: 10, title: 'Later', poster_path: '/l.jpg', release_date: iso(30) },
        { id: 11, title: 'Already out', poster_path: '/o.jpg', release_date: iso(-5) },
        { id: 12, title: 'Soon', poster_path: '/s.jpg', release_date: iso(2) },
        { id: 13, title: 'No date', poster_path: '/n.jpg' },
      ],
    };

    test('movies: future only, soonest first, region passed', async () => {
      mockTmdbGet.mockResolvedValueOnce(raw);
      const out = await getFeed({ feed: 'upcoming', type: 'movie', region: 'IN' });
      expect(mockTmdbGet).toHaveBeenCalledWith('/movie/upcoming', expect.objectContaining({ region: 'IN' }));
      expect(out.items.map((i) => i.Title)).toEqual(['Soon', 'Later']);
    });

    test('series: discover from today, no region, ids are tv', async () => {
      mockTmdbGet.mockResolvedValueOnce({
        total_pages: 1,
        results: [{ id: 20, name: 'New Show', poster_path: '/t.jpg', first_air_date: iso(10) }],
      });
      const out = await getFeed({ feed: 'upcoming', type: 'tv', region: 'IN' });
      const [path, params] = mockTmdbGet.mock.calls[0];
      expect(path).toBe('/discover/tv');
      expect(params['first_air_date.gte']).toBe(iso(0));
      expect(params.region).toBeUndefined();
      expect(out.region).toBe('ALL');
      expect(out.items[0].imdbID).toBe('tmdb:tv:20');
    });
  });

  describe('top-all-time', () => {
    test('ranks across pages, keeps rank when a poster-less title is dropped, no region', async () => {
      mockTmdbGet.mockResolvedValueOnce({
        total_pages: 500,
        results: [
          { id: 1, title: 'First', poster_path: '/1.jpg', release_date: '1972-03-14', vote_average: 8.7 },
          { id: 2, title: 'No poster', poster_path: null },
          { id: 3, title: 'Third', poster_path: '/3.jpg', release_date: '1994-09-23', vote_average: 8.5 },
        ],
      });
      const out = await getFeed({ feed: 'top-all-time', type: 'movie', region: 'IN', page: 2 });
      const [path, params] = mockTmdbGet.mock.calls[0];
      expect(path).toBe('/movie/top_rated');
      expect(params.region).toBeUndefined();
      expect(out.region).toBe('ALL');
      expect(out.items.map((x) => x.rank)).toEqual([21, 23]);
      expect(out.totalPages).toBe(MAX_PAGES);
    });

    test('series use tv top rated; other feeds carry no rank', async () => {
      mockTmdbGet.mockResolvedValueOnce({ total_pages: 1, results: [{ id: 9, name: 'S', poster_path: '/s.jpg', first_air_date: '2008-01-20' }] });
      const tv = await getFeed({ feed: 'top-all-time', type: 'tv' });
      expect(mockTmdbGet.mock.calls[0][0]).toBe('/tv/top_rated');
      expect(tv.items[0].imdbID).toBe('tmdb:tv:9');
      mockTmdbGet.mockResolvedValueOnce(page());
      const th = await getFeed({ feed: 'in-theaters', region: 'IN' });
      expect(th.items[0].rank).toBeUndefined();
    });
  });

  describe('calendar', () => {
    const res = (...r) => ({ results: r });
    test('movies: month range, region, release types, de-duplicated across pages, cached', async () => {
      mockTmdbGet
        .mockResolvedValueOnce(res({ id: 1, title: 'A', poster_path: '/a', release_date: '2026-12-05' }, { id: 2, title: 'NoPoster', release_date: '2026-12-06' }))
        .mockResolvedValueOnce(res({ id: 1, title: 'A', poster_path: '/a', release_date: '2026-12-05' }, { id: 3, title: 'B', poster_path: '/b', release_date: '2026-12-25' }))
        .mockResolvedValueOnce(res());
      const out = await getCalendar({ month: '2026-12', type: 'movie', region: 'in' });
      expect(mockTmdbGet).toHaveBeenCalledTimes(3);
      const [path, params] = mockTmdbGet.mock.calls[0];
      expect(path).toBe('/discover/movie');
      expect(params).toMatchObject({ region: 'IN', 'release_date.gte': '2026-12-01', 'release_date.lte': '2026-12-31', with_release_type: '2|3' });
      expect(out.items.map((x) => x.imdbID)).toEqual(['tmdb:movie:1', 'tmdb:movie:3']);
      await getCalendar({ month: '2026-12', type: 'movie', region: 'IN' });
      expect(mockTmdbGet).toHaveBeenCalledTimes(3);
    });

    test('series premieres: no region, February range, bad month rejected', async () => {
      mockTmdbGet.mockResolvedValue(res({ id: 5, name: 'S', poster_path: '/s', first_air_date: '2028-02-29' }));
      const out = await getCalendar({ month: '2028-02', type: 'tv', region: 'IN' });
      const [, params] = mockTmdbGet.mock.calls[0];
      expect(params['first_air_date.lte']).toBe('2028-02-29');
      expect(params.region).toBeUndefined();
      expect(out.region).toBe('ALL');
      await expect(getCalendar({ month: '2026-13' })).rejects.toMatchObject({ status: 400 });
    });

    test('a failing first page fails; a failing later page is tolerated', async () => {
      mockTmdbGet.mockRejectedValueOnce(new Error('down'));
      await expect(getCalendar({ month: '2026-11', type: 'movie' })).rejects.toThrow('down');
      mockCache.clear();
      mockTmdbGet.mockReset();
      mockTmdbGet
        .mockResolvedValueOnce(res({ id: 1, title: 'A', poster_path: '/a', release_date: '2026-11-05' }))
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x'));
      const out = await getCalendar({ month: '2026-11', type: 'movie' });
      expect(out.items).toHaveLength(1);
    });
  });

  describe('my shows calendar', () => {
    const show = (id, name, last, next) => ({
      id,
      name,
      poster_path: `/${id}`,
      last_episode_to_air: last && { air_date: last, season_number: 1, episode_number: 3, name: 'Three' },
      next_episode_to_air: next && { air_date: next, season_number: 1, episode_number: 4, name: 'Four' },
    });
    test('episodes in the month only, labelled, sorted; a failing show is skipped', async () => {
      mockTmdbGet.mockImplementation(async (path) => {
        if (path === '/tv/1') return show(1, 'One', '2026-11-20', '2026-12-04');
        if (path === '/tv/2') return show(2, 'Two', '2026-12-01', '2026-12-30');
        if (path === '/tv/3') throw new Error('gone');
        return {};
      });
      const out = await getMyShowsCalendar({ month: '2026-12', ids: [1, 2, 3, '2', 'x', -4] });
      expect(out.items.map((i) => `${i.Title}:${i.releaseDate}:${i.episodeLabel}`)).toEqual([
        'Two:2026-12-01:S1E3',
        'One:2026-12-04:S1E4',
        'Two:2026-12-30:S1E4',
      ]);
      expect(mockTmdbGet.mock.calls.map((c) => c[0]).sort()).toEqual(['/tv/1', '/tv/2', '/tv/3']);
    });
    test('no ids -> empty, no TMDB calls', async () => {
      mockTmdbGet.mockReset();
      const out = await getMyShowsCalendar({ month: '2026-12', ids: [] });
      expect(out.items).toEqual([]);
      expect(mockTmdbGet).not.toHaveBeenCalled();
    });
  });

  describe('authors-choice', () => {
    test('comes from the picks store, never TMDB; one page; cached', async () => {
      const out = await getFeed({ feed: 'authors-choice', type: 'tv', region: 'IN' });
      expect(out).toMatchObject({ feed: 'authors-choice', type: 'tv', region: 'ALL', page: 1, totalPages: 1 });
      expect(out.items[0].Title).toBe('pick-tv');
      expect(mockTmdbGet).not.toHaveBeenCalled();
      expect(FEED_IDS).toContain('authors-choice');
    });
  });
});
