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

const { getGenreMap, searchByGenre } = require('../src/services/tmdb/genres');

describe('tmdb genres service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getGenreMap returns cache hit', async () => {
    mockCacheGet.mockResolvedValueOnce({ 28: 'Action' });

    const map = await getGenreMap('movie');

    expect(map).toEqual({ 28: 'Action' });
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });

  test('getGenreMap fetches and caches on miss', async () => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ genres: [{ id: 28, name: 'Action' }] });

    const map = await getGenreMap('movie');

    expect(mockTmdbGet).toHaveBeenCalledWith('/genre/movie/list');
    expect(mockCacheSet).toHaveBeenCalledWith('tmdb:genres:movie', { 28: 'Action' }, 604800);
    expect(map).toEqual({ 28: 'Action' });
  });

  test('searchByGenre returns empty for unknown keyword', async () => {
    const result = await searchByGenre({ genre: 'not-a-genre', page: 2 });

    expect(result).toEqual({ results: [], totalResults: 0, totalPages: 0, page: 2 });
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });

  test('searchByGenre with movie type queries only movie discover endpoint', async () => {
    mockTmdbGet.mockResolvedValueOnce({
      results: [{ id: 1 }, { id: 2 }],
      total_results: 100,
      total_pages: 5,
    });

    const result = await searchByGenre({ genre: 'action', type: 'movie', page: 1 });

    expect(mockTmdbGet).toHaveBeenCalledWith('/discover/movie', {
      with_genres: 28,
      sort_by: 'popularity.desc',
      page: 1,
    });
    expect(result.totalResults).toBe(100);
    expect(result.totalPages).toBe(5);
    expect(result.results).toHaveLength(2);
  });

  test('searchByGenre without type queries movie and tv and limits to 20 items', async () => {
    mockTmdbGet
      .mockResolvedValueOnce({
        results: Array.from({ length: 15 }, (_, i) => ({ id: i + 1 })),
        total_results: 40,
        total_pages: 2,
      })
      .mockResolvedValueOnce({
        results: Array.from({ length: 15 }, (_, i) => ({ id: i + 100 })),
        total_results: 60,
        total_pages: 3,
      });

    const result = await searchByGenre({ genre: 'drama', page: 1 });

    expect(mockTmdbGet).toHaveBeenCalledTimes(2);
    expect(result.totalResults).toBe(100);
    expect(result.totalPages).toBe(3);
    expect(result.results).toHaveLength(20);
  });

  test('searchByGenre handles special keyword anime', async () => {
    mockTmdbGet
      .mockResolvedValueOnce({ results: [{ id: 1 }], total_results: 10, total_pages: 1 })
      .mockResolvedValueOnce({ results: [{ id: 2 }], total_results: 15, total_pages: 2 });

    const result = await searchByGenre({ genre: 'anime', page: 1 });

    expect(mockTmdbGet).toHaveBeenNthCalledWith(1, '/discover/movie', {
      sort_by: 'popularity.desc',
      page: 1,
      with_genres: 16,
      with_keywords: 210,
    });
    expect(mockTmdbGet).toHaveBeenNthCalledWith(2, '/discover/tv', {
      sort_by: 'popularity.desc',
      page: 1,
      with_genres: 16,
      with_keywords: 210,
    });
    expect(result.totalResults).toBe(25);
    expect(result.totalPages).toBe(2);
  });

  test('searchByGenre handles special keyword with origin country on series type', async () => {
    mockTmdbGet.mockResolvedValueOnce({ results: [{ id: 20 }], total_results: 7, total_pages: 1 });

    const result = await searchByGenre({ genre: 'korean', type: 'series', page: 2 });

    expect(mockTmdbGet).toHaveBeenCalledWith('/discover/tv', {
      sort_by: 'popularity.desc',
      page: 2,
      with_origin_country: 'KR',
    });
    expect(result).toMatchObject({ totalResults: 7, totalPages: 1, page: 2 });
  });
});
