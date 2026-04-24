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

const trendingService = require('../src/services/tmdb/trending');

describe('tmdb trending service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('trending filters person results for all/movie/tv types', async () => {
    mockCacheGet.mockResolvedValue(null);
    const mixedResults = {
      results: [
        { media_type: 'movie', title: 'M1' },
        { media_type: 'tv', name: 'T1' },
        { media_type: 'person', name: 'P1' },
      ],
    };
    mockTmdbGet
      .mockResolvedValueOnce(JSON.parse(JSON.stringify(mixedResults)))
      .mockResolvedValueOnce(JSON.parse(JSON.stringify(mixedResults)))
      .mockResolvedValueOnce(JSON.parse(JSON.stringify(mixedResults)));

    const all = await trendingService.trending('all', 'week');
    const movie = await trendingService.trending('movie', 'week');
    const tv = await trendingService.trending('tv', 'week');

    expect(all.data.results).toHaveLength(2);
    expect(movie.data.results).toEqual([{ media_type: 'movie', title: 'M1' }]);
    expect(tv.data.results).toEqual([{ media_type: 'tv', name: 'T1' }]);
  });

  test('getTrendingSearchKeywords uses cache hit', async () => {
    mockCacheGet.mockResolvedValueOnce(['cached-keyword']);

    const result = await trendingService.getTrendingSearchKeywords();

    expect(result).toEqual(['cached-keyword']);
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });

  test('getTrendingSearchKeywords builds keywords from movie/tv trends and caches', async () => {
    mockCacheGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    mockTmdbGet
      .mockResolvedValueOnce({ results: [{ media_type: 'movie', title: 'Movie One' }] })
      .mockResolvedValueOnce({ results: [{ media_type: 'tv', name: 'Show One' }] });

    const result = await trendingService.getTrendingSearchKeywords();

    expect(result).toContain('Movie One');
    expect(result).toContain('Show One');
    expect(result).toContain('action');
    expect(mockCacheSet).toHaveBeenCalledWith('trending:search:keywords', expect.any(Array), 21600);
  });

  test('getTrendingSearchKeywords returns hardcoded fallback on error', async () => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockRejectedValueOnce(new Error('tmdb failed'));

    const result = await trendingService.getTrendingSearchKeywords();

    expect(result).toEqual(expect.arrayContaining(['action', 'comedy', 'documentary']));
  });
});
