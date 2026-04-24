const mockTmdbGet = jest.fn();
const mockResolveByImdbId = jest.fn();
const mockMovieExternalIds = jest.fn();
const mockTvExternalIds = jest.fn();
const mockGetGenreMap = jest.fn();

jest.mock('../src/services/tmdb/client', () => ({
  tmdbGet: (...args) => mockTmdbGet(...args),
}));

jest.mock('../src/services/tmdb/find', () => ({
  resolveByImdbId: (...args) => mockResolveByImdbId(...args),
  movieExternalIds: (...args) => mockMovieExternalIds(...args),
  tvExternalIds: (...args) => mockTvExternalIds(...args),
}));

jest.mock('../src/services/tmdb/genres', () => ({
  getGenreMap: (...args) => mockGetGenreMap(...args),
}));

const { AppError } = require('../src/utils/errors');
const {
  resolveToTmdb,
  searchOmdbLike,
  searchPeople,
  searchByGenreOmdbLike,
  movieDetailsOmdbLike,
  tvDetailsOmdbLike,
  seasonOmdbLike,
  episodeOmdbLike,
} = require('../src/services/tmdb/compat');

describe('tmdb compat service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolveToTmdb handles tmdb, imdb, numeric, and invalid ids', async () => {
    await expect(resolveToTmdb('tmdb:movie:123')).resolves.toEqual({
      media_type: 'movie',
      tmdb_id: 123,
      imdb_id: null,
    });

    mockResolveByImdbId.mockResolvedValueOnce({ movie_results: [{ id: 55 }], tv_results: [] });
    await expect(resolveToTmdb('tt0133093')).resolves.toEqual({
      media_type: 'movie',
      tmdb_id: 55,
      imdb_id: 'tt0133093',
    });

    await expect(resolveToTmdb('456')).resolves.toEqual({
      media_type: 'movie',
      tmdb_id: 456,
      imdb_id: null,
    });

    await expect(resolveToTmdb('bad:id')).rejects.toBeInstanceOf(AppError);
    await expect(resolveToTmdb('bad:id')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('resolveToTmdb throws not found for unresolved imdb id', async () => {
    mockResolveByImdbId.mockResolvedValueOnce({ movie_results: [], tv_results: [] });

    await expect(resolveToTmdb('tt9999999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  test('searchOmdbLike returns false response for empty query', async () => {
    await expect(searchOmdbLike({ q: '   ', page: 1 })).resolves.toEqual({
      Search: [],
      totalResults: '0',
      Response: 'False',
    });
    expect(mockTmdbGet).not.toHaveBeenCalled();
  });

  test('searchOmdbLike maps movie results with genres and poster fallback', async () => {
    mockGetGenreMap.mockResolvedValueOnce({ 28: 'Action' });
    mockTmdbGet.mockResolvedValueOnce({
      results: [
        {
          id: 10,
          title: 'The Matrix',
          release_date: '1999-03-31',
          media_type: 'movie',
          genre_ids: [28],
          poster_path: '/matrix.jpg',
          overview: 'Neo learns the truth.',
        },
      ],
      total_results: 1,
      total_pages: 1,
    });

    const data = await searchOmdbLike({ q: 'Matrix', type: 'movie', page: 1 });

    expect(mockTmdbGet).toHaveBeenCalledWith('/search/movie', { query: 'Matrix', page: 1 });
    expect(data.Response).toBe('True');
    expect(data.Search[0]).toMatchObject({
      Title: 'The Matrix',
      Year: '1999',
      imdbID: 'tmdb:movie:10',
      Type: 'movie',
      Genre: 'Action',
    });
  });

  test('searchOmdbLike multi endpoint filters out non movie/tv media', async () => {
    mockTmdbGet.mockResolvedValueOnce({
      results: [
        {
          id: 20,
          title: 'Movie One',
          release_date: '2001-01-01',
          media_type: 'movie',
          genre_ids: [],
          poster_path: null,
          overview: 'desc',
        },
        {
          id: 21,
          media_type: 'person',
          name: 'Someone',
        },
      ],
      total_results: 2,
      total_pages: 1,
    });

    const data = await searchOmdbLike({ q: 'one', type: undefined, page: 1 });

    expect(mockTmdbGet).toHaveBeenCalledWith('/search/multi', { query: 'one', page: 1 });
    expect(data.Search).toHaveLength(1);
    expect(data.Search[0].Poster).toBe('N/A');
  });

  test('movieDetailsOmdbLike uses external ids fallback and formats credits', async () => {
    mockTmdbGet
      .mockResolvedValueOnce({
        title: 'The Matrix',
        release_date: '1999-03-31',
        runtime: 136,
        genres: [{ name: 'Action' }],
        overview: 'Plot',
        original_language: 'en',
        production_countries: [{ name: 'USA' }],
        poster_path: '/matrix.jpg',
        vote_average: 8.7,
        vote_count: 20000,
      })
      .mockResolvedValueOnce({
        crew: [
          { job: 'Director', name: 'Lana Wachowski' },
          { department: 'Writing', name: 'Lilly Wachowski' },
        ],
        cast: [{ name: 'Keanu Reeves' }],
      });
    mockMovieExternalIds.mockResolvedValueOnce({ imdb_id: 'tt0133093' });

    const details = await movieDetailsOmdbLike({ tmdb_id: 603, imdb_id: null });

    expect(details).toMatchObject({
      Title: 'The Matrix',
      Runtime: '136 min',
      Director: 'Lana Wachowski',
      imdbID: 'tt0133093',
      Type: 'movie',
    });
  });

  test('tvDetailsOmdbLike uses external ids fallback and season count', async () => {
    mockTmdbGet.mockResolvedValueOnce({
      name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      episode_run_time: [47],
      genres: [{ name: 'Drama' }],
      overview: 'Plot',
      original_language: 'en',
      origin_country: ['US'],
      poster_path: '/bb.jpg',
      vote_average: 9.5,
      vote_count: 15000,
      number_of_seasons: 5,
    });
    mockTvExternalIds.mockResolvedValueOnce({ imdb_id: 'tt0903747' });

    const details = await tvDetailsOmdbLike({ tmdb_id: 1396, imdb_id: null });

    expect(details).toMatchObject({
      Title: 'Breaking Bad',
      Runtime: '47 min',
      imdbID: 'tt0903747',
      Type: 'series',
      totalSeasons: 5,
    });
  });

  test('season and episode omdb-like mapping', async () => {
    mockTmdbGet
      .mockResolvedValueOnce({
        episodes: [
          {
            name: 'Pilot',
            air_date: '2008-01-20',
            episode_number: 1,
            vote_average: 8.4,
            runtime: 58,
          },
        ],
      })
      .mockResolvedValueOnce({
        name: 'Pilot',
        air_date: '2008-01-20',
        runtime: 58,
      });

    const season = await seasonOmdbLike({ tmdb_tv_id: 1396, season_number: 1 });
    const episode = await episodeOmdbLike({ tmdb_tv_id: 1396, season_number: 1, episode_number: 1 });

    expect(season).toMatchObject({ Season: '1', Response: 'True' });
    expect(season.Episodes[0]).toMatchObject({ Title: 'Pilot', Runtime: '58 min' });
    expect(episode).toMatchObject({ Season: '1', Episode: '1', Runtime: '58 min', Response: 'True' });
  });

  test('searchPeople aggregates top works and ignores per-person failures', async () => {
    mockTmdbGet
      .mockResolvedValueOnce({
        results: [
          { id: 1, name: 'Person One' },
          { id: 2, name: 'Person Two' },
        ],
        total_pages: 1,
        total_results: 2,
      })
      .mockResolvedValueOnce({
        cast: [
          {
            id: 101,
            media_type: 'movie',
            title: 'Movie A',
            release_date: '2010-01-01',
            character: 'Lead',
            vote_count: 120,
            vote_average: 7.2,
            popularity: 10,
            poster_path: '/a.jpg',
          },
        ],
        crew: [],
      })
      .mockRejectedValueOnce(new Error('person fetch failed'));

    const data = await searchPeople({ q: 'Keanu', page: 1 });

    expect(mockTmdbGet).toHaveBeenCalledWith('/search/person', { query: 'Keanu', page: 1 });
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      Title: 'Movie A',
      imdbID: 'tmdb:movie:101',
      Actors: 'Person One',
      _personMatch: 'Person One',
    });
    expect(data.totalResults).toBe(1);
  });

  test('searchByGenreOmdbLike maps mixed media using type-specific genre maps', async () => {
    mockGetGenreMap.mockResolvedValueOnce({ 28: 'Action' }).mockResolvedValueOnce({ 18: 'Drama' });

    const data = await searchByGenreOmdbLike({
      genreResults: {
        results: [
          {
            id: 100,
            media_type: 'movie',
            title: 'Movie',
            release_date: '2011-01-01',
            genre_ids: [28],
            poster_path: '/m.jpg',
            vote_average: 7.1,
          },
          {
            id: 101,
            media_type: 'tv',
            name: 'Series',
            first_air_date: '2012-01-01',
            genre_ids: [18],
            poster_path: '/s.jpg',
            vote_average: 8.1,
          },
        ],
        totalResults: 2,
        totalPages: 1,
        page: 1,
      },
    });

    expect(data.Response).toBe('True');
    expect(data.Search).toHaveLength(2);
    expect(data.Search[0]).toMatchObject({ Type: 'movie', Genre: 'Action' });
    expect(data.Search[1]).toMatchObject({ Type: 'series', Genre: 'Drama' });
  });
});
