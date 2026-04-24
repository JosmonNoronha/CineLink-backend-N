const mockSearchOmdbLike = jest.fn();
const mockSearchPeople = jest.fn();
const mockSearchByGenreOmdbLike = jest.fn();
const mockSearchByGenre = jest.fn();

jest.mock('../src/services/tmdb/compat', () => ({
  searchOmdbLike: (...args) => mockSearchOmdbLike(...args),
  searchPeople: (...args) => mockSearchPeople(...args),
  searchByGenreOmdbLike: (...args) => mockSearchByGenreOmdbLike(...args),
}));

jest.mock('../src/services/tmdb/genres', () => ({
  searchByGenre: (...args) => mockSearchByGenre(...args),
}));

const { AppError } = require('../src/utils/errors');
const {
  unifiedSearch,
  isGenreSearch,
  shouldRunPersonSearch,
  normalizeQuery,
} = require('../src/services/search/unified');

describe('unified search service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes query spacing and punctuation checks', () => {
    expect(normalizeQuery('  the   matrix  ')).toBe('the matrix');
    expect(isGenreSearch(' Action ')).toBe(true);
    expect(isGenreSearch('thrillers')).toBe(true);
    expect(shouldRunPersonSearch('Keanu Reeves')).toBe(true);
    expect(shouldRunPersonSearch('ab')).toBe(false);
    expect(shouldRunPersonSearch('action')).toBe(false);
    expect(shouldRunPersonSearch('j@ne')).toBe(false);
  });

  test('returns empty payload for empty query', async () => {
    const data = await unifiedSearch({ query: '   ' });

    expect(data).toMatchObject({
      Search: [],
      totalResults: '0',
      Response: 'False',
      meta: {
        hasMore: false,
        isTotalExact: true,
        source: 'empty',
      },
    });
    expect(mockSearchOmdbLike).not.toHaveBeenCalled();
    expect(mockSearchPeople).not.toHaveBeenCalled();
  });

  test('throws AppError for invalid cursor', async () => {
    await expect(unifiedSearch({ query: 'Matrix', cursor: '!!!invalid!!!' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('throws AppError when cursor query/type mismatch', async () => {
    const cursor = Buffer.from(JSON.stringify({ query: 'Batman', type: 'movie', page: 2 }), 'utf8').toString(
      'base64url'
    );

    await expect(unifiedSearch({ query: 'Matrix', type: 'all', cursor })).rejects.toBeInstanceOf(AppError);
    await expect(unifiedSearch({ query: 'Matrix', type: 'all', cursor })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('handles genre search with exact totals and next cursor', async () => {
    mockSearchByGenre.mockResolvedValue({
      results: [{ id: 1 }],
      totalPages: 3,
    });
    mockSearchByGenreOmdbLike.mockResolvedValue({
      Search: [{ Title: 'Action Movie', imdbID: 'tt001', Type: 'movie' }],
      totalResults: '41',
      Response: 'True',
    });

    const data = await unifiedSearch({ query: 'action', page: 1, type: 'movie' });

    expect(mockSearchByGenre).toHaveBeenCalledWith({ genre: 'action', type: 'movie', page: 1 });
    expect(data.Response).toBe('True');
    expect(data.meta).toMatchObject({
      hasMore: true,
      isTotalExact: true,
      source: 'genre',
      totalResultsExact: 41,
    });
    expect(typeof data.meta.nextCursor).toBe('string');
  });

  test('blends person and title results with de-duplication and filtering', async () => {
    mockSearchOmdbLike.mockResolvedValue({
      Search: [
        { Title: 'The Matrix', imdbID: 'tt0133093', Type: 'movie' },
        { Title: 'Matrix Reloaded', imdbID: 'tt0234215', Type: 'movie' },
      ],
      totalResults: '2',
      totalPages: 1,
    });
    mockSearchPeople.mockResolvedValue({
      results: [
        { Title: 'The Matrix', imdbID: 'tt0133093', Type: 'movie' },
        { Title: 'Animatrix', imdbID: 'tt0328832', Type: 'movie' },
      ],
      totalResults: 2,
      totalPages: 1,
      peopleTotalResults: 2,
    });

    const data = await unifiedSearch({ query: 'Keanu Reeves', page: 1, type: 'movie' });

    expect(mockSearchOmdbLike).toHaveBeenCalledWith({ q: 'Keanu Reeves', type: 'movie', page: 1 });
    expect(mockSearchPeople).toHaveBeenCalledWith({ q: 'Keanu Reeves', page: 1 });
    expect(data.Response).toBe('True');
    expect(data.Search.map((x) => x.imdbID)).toEqual(['tt0133093', 'tt0328832', 'tt0234215']);
    expect(data.meta).toMatchObject({
      hasMore: false,
      isTotalExact: false,
      source: 'blended',
      totalResultsEstimated: 4,
    });
    expect(data.meta.nextCursor).toBeNull();
  });

  test('uses title-only source when person search is skipped', async () => {
    mockSearchOmdbLike.mockResolvedValue({
      Search: [{ Title: 'The Matrix', imdbID: 'tt0133093', Type: 'movie' }],
      totalResults: '30',
      totalPages: 2,
    });

    const data = await unifiedSearch({ query: 'sci-fi', page: 1, type: 'all' });

    expect(mockSearchPeople).not.toHaveBeenCalled();
    expect(data.meta.source).toBe('genre');
  });

  test('respects page from cursor when present', async () => {
    mockSearchOmdbLike.mockResolvedValue({
      Search: [{ Title: 'The Matrix', imdbID: 'tt0133093', Type: 'movie' }],
      totalResults: '40',
      totalPages: 4,
    });
    mockSearchPeople.mockResolvedValue({
      results: [],
      totalResults: 0,
      totalPages: 0,
      peopleTotalResults: 0,
    });

    const cursor = Buffer.from(JSON.stringify({ query: 'Matrix', type: 'all', page: 3 }), 'utf8').toString(
      'base64url'
    );

    const data = await unifiedSearch({ query: 'Matrix', type: 'all', page: 1, cursor });

    expect(mockSearchOmdbLike).toHaveBeenCalledWith({ q: 'Matrix', type: undefined, page: 3 });
    expect(data.meta.hasMore).toBe(true);
    expect(typeof data.meta.nextCursor).toBe('string');
  });
});
