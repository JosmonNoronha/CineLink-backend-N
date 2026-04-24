const request = require('supertest');
const express = require('express');

const mockMulti = jest.fn();
const mockMovie = jest.fn();
const mockTv = jest.fn();
const mockPerson = jest.fn();
const mockSearchPeople = jest.fn();
const mockSearchByGenreOmdbLike = jest.fn();
const mockSearchByGenre = jest.fn();
const mockUnifiedSearch = jest.fn();
const mockGetPopularSearches = jest.fn();
const mockGetTrendingKeywords = jest.fn();

jest.mock('../src/services/tmdb/search', () => ({
  multi: (...args) => mockMulti(...args),
  movie: (...args) => mockMovie(...args),
  tv: (...args) => mockTv(...args),
  person: (...args) => mockPerson(...args),
}));

jest.mock('../src/services/tmdb/compat', () => ({
  searchPeople: (...args) => mockSearchPeople(...args),
  searchByGenreOmdbLike: (...args) => mockSearchByGenreOmdbLike(...args),
}));

jest.mock('../src/services/tmdb/genres', () => ({
  searchByGenre: (...args) => mockSearchByGenre(...args),
}));

jest.mock('../src/services/search/unified', () => ({
  unifiedSearch: (...args) => mockUnifiedSearch(...args),
}));

jest.mock('../src/services/analytics', () => ({
  analyticsService: {
    getPopularSearches: (...args) => mockGetPopularSearches(...args),
  },
}));

jest.mock('../src/services/tmdb/trending', () => ({
  getTrendingSearchKeywords: (...args) => mockGetTrendingKeywords(...args),
}));

const searchRouter = require('../src/routes/search');
const { errorHandler } = require('../src/middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.analytics = {
      trackSearch: jest.fn().mockResolvedValue(undefined),
    };
    next();
  });
  app.use('/api/search', searchRouter);
  app.use(errorHandler);
  return app;
}

describe('search routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/search/suggestions merges, filters and deduplicates suggestions', async () => {
    mockGetPopularSearches.mockResolvedValueOnce([
      { query: 'Matrix' },
      { query: 'Batman' },
      { query: 'Matrix' },
    ]);
    mockGetTrendingKeywords.mockResolvedValueOnce(['Matrix Resurrections', 'Top Gun']);

    const app = buildApp();
    const res = await request(app).get('/api/search/suggestions?query=mat&limit=3');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      suggestions: ['Matrix', 'Matrix Resurrections'],
      source: 'analytics+trending',
    });
  });

  test('GET /api/search/suggestions falls back to trending source', async () => {
    mockGetPopularSearches.mockResolvedValueOnce([]);
    mockGetTrendingKeywords.mockResolvedValueOnce(['Dune', 'Fallout']);

    const app = buildApp();
    const res = await request(app).get('/api/search/suggestions?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      suggestions: ['Dune', 'Fallout'],
      source: 'trending',
    });
  });

  test('GET /api/search/multi validates query and returns service payload', async () => {
    mockMulti.mockResolvedValueOnce({ data: { Search: [{ Title: 'Matrix' }] }, source: 'tmdb' });

    const app = buildApp();
    const okRes = await request(app).get('/api/search/multi?query=matrix&page=1');

    expect(okRes.status).toBe(200);
    expect(mockMulti).toHaveBeenCalledWith('matrix', 1);
    expect(okRes.body).toMatchObject({ success: true, meta: { source: 'tmdb' } });

    const badRes = await request(app).get('/api/search/multi?page=1');
    expect(badRes.status).toBe(400);
    expect(badRes.body.success).toBe(false);
    expect(badRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET /api/search/movie and /tv proxy to search service', async () => {
    mockMovie.mockResolvedValueOnce({ data: { Search: [{ Title: 'Inception' }] }, source: 'tmdb' });
    mockTv.mockResolvedValueOnce({ data: { Search: [{ Title: 'Dark' }] }, source: 'tmdb' });

    const app = buildApp();
    const movieRes = await request(app).get('/api/search/movie?query=inception&page=2');
    const tvRes = await request(app).get('/api/search/tv?query=dark&page=1');

    expect(movieRes.status).toBe(200);
    expect(tvRes.status).toBe(200);
    expect(mockMovie).toHaveBeenCalledWith('inception', 2);
    expect(mockTv).toHaveBeenCalledWith('dark', 1);
  });

  test('GET /api/search/person proxies to tmdb search person service', async () => {
    mockPerson.mockResolvedValueOnce({ data: { Search: [{ Title: 'Speed' }] }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app).get('/api/search/person?query=keanu&page=1');

    expect(res.status).toBe(200);
    expect(mockPerson).toHaveBeenCalledWith('keanu', 1);
  });

  test('GET /api/search/by-person returns compat person results', async () => {
    mockSearchPeople.mockResolvedValueOnce({
      results: [{ Title: 'The Matrix', imdbID: 'tmdb:movie:603' }],
      totalResults: 1,
    });

    const app = buildApp();
    const res = await request(app).get('/api/search/by-person?query=keanu&page=1');

    expect(res.status).toBe(200);
    expect(mockSearchPeople).toHaveBeenCalledWith({ q: 'keanu', page: 1 });
    expect(res.body.data.totalResults).toBe(1);
  });

  test('GET /api/search/by-genre composes genre pipeline', async () => {
    mockSearchByGenre.mockResolvedValueOnce({
      results: [{ id: 1, title: 'Action Movie' }],
      totalResults: 1,
      totalPages: 1,
      page: 1,
    });
    mockSearchByGenreOmdbLike.mockResolvedValueOnce({
      Search: [{ Title: 'Action Movie', imdbID: 'tmdb:movie:1' }],
      totalResults: '1',
      Response: 'True',
    });

    const app = buildApp();
    const res = await request(app).get('/api/search/by-genre?genre=action&type=movie&page=1');

    expect(res.status).toBe(200);
    expect(mockSearchByGenre).toHaveBeenCalledWith({ genre: 'action', type: 'movie', page: 1 });
    expect(mockSearchByGenreOmdbLike).toHaveBeenCalled();
    expect(res.body.data.Response).toBe('True');
  });

  test('POST /api/search uses unified service and returns payload', async () => {
    mockUnifiedSearch.mockResolvedValueOnce({
      Search: [{ Title: 'Matrix', imdbID: 'tmdb:movie:603' }],
      totalResults: '1',
      Response: 'True',
      meta: { source: 'title', hasMore: false },
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/search')
      .send({ query: 'Matrix', type: 'all', page: 1, filters: {} });

    expect(res.status).toBe(200);
    expect(mockUnifiedSearch).toHaveBeenCalledWith({
      query: 'Matrix',
      type: 'all',
      page: 1,
      filters: {},
      cursor: undefined,
    });
    expect(res.body.data.Response).toBe('True');
  });
});
