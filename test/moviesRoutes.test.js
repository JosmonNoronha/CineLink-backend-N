const request = require('supertest');
const express = require('express');

const mockMovieService = {
  listPopular: jest.fn(),
  listTopRated: jest.fn(),
  listNowPlaying: jest.fn(),
  listUpcoming: jest.fn(),
  details: jest.fn(),
  credits: jest.fn(),
  videos: jest.fn(),
  images: jest.fn(),
  recommendations: jest.fn(),
  watchProviders: jest.fn(),
};
const mockReviewService = { getMovieReviews: jest.fn() };
const mockCompat = {
  searchOmdbLike: jest.fn(),
  resolveToTmdb: jest.fn(),
  movieDetailsOmdbLike: jest.fn(),
  tvDetailsOmdbLike: jest.fn(),
  seasonOmdbLike: jest.fn(),
  episodeOmdbLike: jest.fn(),
};

jest.mock('../src/services/tmdb/movies', () => mockMovieService);
jest.mock('../src/services/tmdb/reviews', () => mockReviewService);
jest.mock('../src/services/tmdb/compat', () => mockCompat);

const router = require('../src/routes/movies');
const { errorHandler } = require('../src/middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.analytics = {
      trackSearch: jest.fn().mockResolvedValue(undefined),
      trackMovieView: jest.fn().mockResolvedValue(undefined),
      trackTVView: jest.fn().mockResolvedValue(undefined),
    };
    next();
  });
  app.use('/api/movies', router);
  app.use(errorHandler);
  return app;
}

describe('movies routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('legacy /search validates and returns compat results', async () => {
    mockCompat.searchOmdbLike.mockResolvedValueOnce({ Search: [{ Title: 'Matrix' }], Response: 'True' });

    const app = buildApp();
    const okRes = await request(app).get('/api/movies/search?q=matrix&type=all&page=1');
    const badRes = await request(app).get('/api/movies/search?page=1');

    expect(okRes.status).toBe(200);
    expect(mockCompat.searchOmdbLike).toHaveBeenCalledWith({ q: 'matrix', type: undefined, page: 1 });
    expect(badRes.status).toBe(400);
  });

  test('legacy /details resolves movie and tv branches with analytics tracking', async () => {
    mockCompat.resolveToTmdb
      .mockResolvedValueOnce({ media_type: 'movie', tmdb_id: 603, imdb_id: 'tt0133093' })
      .mockResolvedValueOnce({ media_type: 'tv', tmdb_id: 1396, imdb_id: 'tt0903747' });
    mockCompat.movieDetailsOmdbLike.mockResolvedValueOnce({ Title: 'The Matrix' });
    mockCompat.tvDetailsOmdbLike.mockResolvedValueOnce({ Title: 'Breaking Bad' });

    const app = buildApp();
    const movieRes = await request(app).get('/api/movies/details/tt0133093');
    const tvRes = await request(app).get('/api/movies/details/tt0903747');

    expect(movieRes.status).toBe(200);
    expect(tvRes.status).toBe(200);
    expect(mockCompat.movieDetailsOmdbLike).toHaveBeenCalled();
    expect(mockCompat.tvDetailsOmdbLike).toHaveBeenCalled();
  });

  test('season and episode endpoints handle non-tv fallback and tv success', async () => {
    mockCompat.resolveToTmdb
      .mockResolvedValueOnce({ media_type: 'movie', tmdb_id: 1 })
      .mockResolvedValueOnce({ media_type: 'tv', tmdb_id: 2 })
      .mockResolvedValueOnce({ media_type: 'movie', tmdb_id: 1 })
      .mockResolvedValueOnce({ media_type: 'tv', tmdb_id: 2 });
    mockCompat.seasonOmdbLike.mockResolvedValueOnce({ Season: '1', Episodes: [], Response: 'True' });
    mockCompat.episodeOmdbLike.mockResolvedValueOnce({ Response: 'True' });

    const app = buildApp();
    const seasonFallback = await request(app).get('/api/movies/season/tt1/1');
    const seasonTv = await request(app).get('/api/movies/season/tt2/1');
    const episodeFallback = await request(app).get('/api/movies/episode/tt1/1/1');
    const episodeTv = await request(app).get('/api/movies/episode/tt2/1/1');

    expect(seasonFallback.status).toBe(200);
    expect(seasonFallback.body.data.Response).toBe('False');
    expect(seasonTv.body.data.Response).toBe('True');
    expect(episodeFallback.body.data.Response).toBe('False');
    expect(episodeTv.body.data.Response).toBe('True');
  });

  test('batch-details returns mixed success/error rows', async () => {
    mockCompat.resolveToTmdb
      .mockResolvedValueOnce({ media_type: 'movie', tmdb_id: 603, imdb_id: 'tt0133093' })
      .mockRejectedValueOnce(new Error('resolve failed'));
    mockCompat.movieDetailsOmdbLike.mockResolvedValueOnce({ Title: 'The Matrix' });

    const app = buildApp();
    const res = await request(app)
      .post('/api/movies/batch-details')
      .send({ imdbIDs: ['tt0133093', 'bad'] });

    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(2);
    expect(res.body.data.results[0].error).toBeNull();
    expect(res.body.data.results[1].error).toBe('resolve failed');
  });

  test.each([
    ['/popular?page=1', 'listPopular', [1]],
    ['/top-rated?page=1', 'listTopRated', [1]],
    ['/now-playing?page=1', 'listNowPlaying', [1]],
    ['/upcoming?page=1', 'listUpcoming', [1]],
    ['/123', 'details', [123]],
    ['/123/credits', 'credits', [123]],
    ['/123/videos', 'videos', [123]],
    ['/123/images', 'images', [123]],
    ['/123/recommendations?page=2', 'recommendations', [123, 2]],
    ['/123/watch-providers', 'watchProviders', [123]],
  ])('service route %s proxies to %s', async (path, method, args) => {
    mockMovieService[method].mockResolvedValueOnce({ data: { ok: true }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app).get(`/api/movies${path}`);

    expect(res.status).toBe(200);
    expect(mockMovieService[method]).toHaveBeenCalledWith(...args);
    expect(res.body.meta.source).toBe('tmdb');
  });

  test('/:id/reviews proxies to movie reviews service', async () => {
    mockReviewService.getMovieReviews.mockResolvedValueOnce({ data: { results: [] }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app).get('/api/movies/123/reviews?page=1');

    expect(res.status).toBe(200);
    expect(mockReviewService.getMovieReviews).toHaveBeenCalledWith(123, 1);
  });
});
