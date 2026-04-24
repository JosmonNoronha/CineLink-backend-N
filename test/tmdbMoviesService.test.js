const mockTmdbGet = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock('../src/services/tmdb/client', () => ({
  tmdbGet: (...args) => mockTmdbGet(...args),
}));

jest.mock('../src/services/tmdb/cache', () => ({
  cacheGet: (...args) => mockCacheGet(...args),
  cacheSet: (...args) => mockCacheSet(...args),
}));

const movies = require('../src/services/tmdb/movies');

describe('tmdb movies service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['listPopular', '/movie/popular', { page: 1 }, 21600],
    ['listTopRated', '/movie/top_rated', { page: 1 }, 21600],
    ['listNowPlaying', '/movie/now_playing', { page: 1 }, 21600],
    ['listUpcoming', '/movie/upcoming', { page: 1 }, 21600],
    ['details', '/movie/99', {}, 86400, [99]],
    ['credits', '/movie/99/credits', {}, 86400, [99]],
    ['videos', '/movie/99/videos', {}, 86400, [99]],
    ['images', '/movie/99/images', {}, 86400, [99]],
    ['recommendations', '/movie/99/recommendations', { page: 2 }, 21600, [99, 2]],
    ['watchProviders', '/movie/99/watch/providers', {}, 86400, [99]],
  ])('%s caches and returns tmdb miss path', async (method, path, params, ttl, args = []) => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ ok: true });

    const res = await movies[method](...args);

    expect(mockTmdbGet).toHaveBeenCalledWith(path, params);
    expect(mockCacheSet).toHaveBeenCalledWith(`tmdb:${path}:${JSON.stringify(params)}`, { ok: true }, ttl);
    expect(res).toEqual({ data: { ok: true }, source: 'tmdb' });
  });

  test('details returns cache hit without tmdb call', async () => {
    mockCacheGet.mockResolvedValueOnce({ hit: true });

    const res = await movies.details(77);

    expect(res).toEqual({ data: { hit: true }, source: 'cache' });
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });
});
