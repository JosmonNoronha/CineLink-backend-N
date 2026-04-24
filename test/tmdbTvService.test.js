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

const tv = require('../src/services/tmdb/tv');

describe('tmdb tv service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['listPopular', '/tv/popular', { page: 1 }, 21600],
    ['listTopRated', '/tv/top_rated', { page: 1 }, 21600],
    ['listAiringToday', '/tv/airing_today', { page: 1 }, 21600],
    ['listOnTheAir', '/tv/on_the_air', { page: 1 }, 21600],
    ['details', '/tv/10', {}, 86400, [10]],
    ['season', '/tv/10/season/2', {}, 86400, [10, 2]],
    ['episode', '/tv/10/season/2/episode/3', {}, 86400, [10, 2, 3]],
    ['credits', '/tv/10/credits', {}, 86400, [10]],
    ['videos', '/tv/10/videos', {}, 86400, [10]],
    ['seasonVideos', '/tv/10/season/2/videos', {}, 86400, [10, 2]],
    ['images', '/tv/10/images', {}, 86400, [10]],
    ['recommendations', '/tv/10/recommendations', { page: 4 }, 21600, [10, 4]],
    ['watchProviders', '/tv/10/watch/providers', {}, 86400, [10]],
  ])('%s caches and returns tmdb miss path', async (method, path, params, ttl, args = []) => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ ok: true });

    const res = await tv[method](...args);

    expect(mockTmdbGet).toHaveBeenCalledWith(path, params);
    expect(mockCacheSet).toHaveBeenCalledWith(`tmdb:${path}:${JSON.stringify(params)}`, { ok: true }, ttl);
    expect(res).toEqual({ data: { ok: true }, source: 'tmdb' });
  });

  test('listPopular returns cache hit', async () => {
    mockCacheGet.mockResolvedValueOnce({ hit: true });

    const res = await tv.listPopular(1);

    expect(res).toEqual({ data: { hit: true }, source: 'cache' });
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });
});
