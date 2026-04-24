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

const searchService = require('../src/services/tmdb/search');

describe('tmdb search service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['multi', '/search/multi'],
    ['movie', '/search/movie'],
    ['tv', '/search/tv'],
    ['person', '/search/person'],
  ])('%s returns cache hit', async (method, path) => {
    mockCacheGet.mockResolvedValueOnce({ results: ['cached'] });

    const res = await searchService[method]('matrix', 2);

    expect(mockCacheGet).toHaveBeenCalledWith(`tmdb:${path}:{"query":"matrix","page":2}`);
    expect(mockTmdbGet).not.toHaveBeenCalled();
    expect(res).toEqual({ data: { results: ['cached'] }, source: 'cache' });
  });

  test.each([
    ['multi', '/search/multi'],
    ['movie', '/search/movie'],
    ['tv', '/search/tv'],
    ['person', '/search/person'],
  ])('%s fetches from tmdb and caches on miss', async (method, path) => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ results: ['tmdb'] });

    const res = await searchService[method]('matrix', 1);

    expect(mockTmdbGet).toHaveBeenCalledWith(path, { query: 'matrix', page: 1 });
    expect(mockCacheSet).toHaveBeenCalledWith(
      `tmdb:${path}:{"query":"matrix","page":1}`,
      { results: ['tmdb'] },
      3600
    );
    expect(res).toEqual({ data: { results: ['tmdb'] }, source: 'tmdb' });
  });
});
