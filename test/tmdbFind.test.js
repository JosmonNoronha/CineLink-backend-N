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

const { resolveByImdbId, movieExternalIds, tvExternalIds } = require('../src/services/tmdb/find');

describe('tmdb find service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolveByImdbId returns cache hit without API call', async () => {
    mockCacheGet.mockResolvedValueOnce({ movie_results: [{ id: 1 }] });

    const data = await resolveByImdbId('tt0133093');

    expect(data).toEqual({ movie_results: [{ id: 1 }] });
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });

  test('resolveByImdbId fetches and caches on miss', async () => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ movie_results: [{ id: 603 }], tv_results: [] });

    const data = await resolveByImdbId('tt0133093');

    expect(mockTmdbGet).toHaveBeenCalledWith('/find/tt0133093', { external_source: 'imdb_id' });
    expect(mockCacheSet).toHaveBeenCalledWith(
      'tmdb:/find:tt0133093',
      { movie_results: [{ id: 603 }], tv_results: [] },
      86400
    );
    expect(data.movie_results[0].id).toBe(603);
  });

  test('movieExternalIds uses cache then API fallback', async () => {
    mockCacheGet.mockResolvedValueOnce({ imdb_id: 'tt0111161' });
    const hit = await movieExternalIds(278);
    expect(hit).toEqual({ imdb_id: 'tt0111161' });

    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ imdb_id: 'tt0111161' });
    const miss = await movieExternalIds(278);

    expect(mockTmdbGet).toHaveBeenCalledWith('/movie/278/external_ids');
    expect(mockCacheSet).toHaveBeenCalledWith(
      'tmdb:/movie/278/external_ids',
      { imdb_id: 'tt0111161' },
      86400
    );
    expect(miss.imdb_id).toBe('tt0111161');
  });

  test('tvExternalIds uses cache then API fallback', async () => {
    mockCacheGet.mockResolvedValueOnce({ imdb_id: 'tt0903747' });
    const hit = await tvExternalIds(1396);
    expect(hit).toEqual({ imdb_id: 'tt0903747' });

    mockCacheGet.mockResolvedValueOnce(null);
    mockTmdbGet.mockResolvedValueOnce({ imdb_id: 'tt0903747' });
    const miss = await tvExternalIds(1396);

    expect(mockTmdbGet).toHaveBeenCalledWith('/tv/1396/external_ids');
    expect(mockCacheSet).toHaveBeenCalledWith('tmdb:/tv/1396/external_ids', { imdb_id: 'tt0903747' }, 86400);
    expect(miss.imdb_id).toBe('tt0903747');
  });
});
