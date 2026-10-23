require('express-async-errors');

const request = require('supertest');
const express = require('express');

const mockRecoService = { getRecommendations: jest.fn() };
const mockTmdbGet = jest.fn();
const mockGetGenreMap = jest.fn();
const mockAxiosPost = jest.fn();
const mockLoggerError = jest.fn();
const { errorHandler } = require('../src/middleware/errorHandler');

jest.mock('../src/services/tmdb/recommendations', () => mockRecoService);
jest.mock('../src/services/tmdb/client', () => ({ tmdbGet: (...args) => mockTmdbGet(...args) }));
jest.mock('../src/services/tmdb/genres', () => ({ getGenreMap: (...args) => mockGetGenreMap(...args) }));
jest.mock('axios', () => ({ post: (...args) => mockAxiosPost(...args) }));
jest.mock('../src/utils/logger', () => ({
  logger: { error: (...args) => mockLoggerError(...args), warn: jest.fn(), info: jest.fn() },
}));
// Mock optionalAuth to avoid Firebase calls during tests. If the
// Authorization header equals 'Bearer valid-token' we'll populate `req.user`.
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    const { AppError } = require('../src/utils/errors');
    if (req.headers.authorization !== 'Bearer valid-token') {
      return next(new AppError('Missing Authorization bearer token', 401, 'UNAUTHORIZED'));
    }
    req.user = { uid: req.headers['x-test-user'] || 'test-user-1', email: 'test@example.com' };
    return next();
  },
  optionalAuth: (req, _res, next) => {
    const header = req.headers.authorization || '';
    if (header === 'Bearer valid-token') {
      req.user = { uid: 'test-user-1', email: 'test@example.com' };
    }
    return next();
  },
}));

const router = require('../src/routes/recommendations');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/recommendations', router);
  app.use(errorHandler);
  return app;
}

describe('recommendations routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('POST / in legacy title mode returns enriched compat recommendations', async () => {
    mockTmdbGet.mockResolvedValueOnce({ results: [{ id: 500 }] });
    mockRecoService.getRecommendations.mockResolvedValueOnce({
      data: {
        results: [
          {
            id: 1,
            title: 'Rec',
            release_date: '2020-01-01',
            genre_ids: [28],
            vote_average: 8.1,
            poster_path: '/p.jpg',
          },
        ],
      },
    });
    mockGetGenreMap.mockResolvedValueOnce({ 28: 'Action' });

    const app = buildApp();
    const res = await request(app).post('/api/recommendations').send({ title: 'Matrix', top_n: 1 });

    expect(res.status).toBe(200);
    expect(mockTmdbGet).toHaveBeenCalledWith('/search/movie', { query: 'Matrix', page: 1 });
    expect(res.body.data.recommendations[0]).toMatchObject({
      title: 'Rec',
      genres: 'Action',
      imdbID: 'tmdb:movie:1',
    });
  });

  test('POST / legacy title mode returns empty when no movie found', async () => {
    mockTmdbGet.mockResolvedValueOnce({ results: [] });

    const app = buildApp();
    const res = await request(app).post('/api/recommendations').send({ title: 'Unknown' });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendations).toEqual([]);
  });

  test('POST / standard mode proxies to recommendation service', async () => {
    mockRecoService.getRecommendations.mockResolvedValueOnce({ data: { results: [] }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app)
      .post('/api/recommendations')
      .send({ media_type: 'movie', tmdb_id: 603, page: 1 });

    expect(res.status).toBe(200);
    expect(mockRecoService.getRecommendations).toHaveBeenCalledWith({
      media_type: 'movie',
      tmdb_id: 603,
      page: 1,
    });
    expect(res.body.meta.source).toBe('tmdb');
  });

  test('POST /ml returns external ML payload', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        recommendations: [{ title: 'Rec A' }],
        found_titles: ['Matrix'],
        message: 'ok',
        processing_time: 1.2,
        recommendation_sources: ['model'],
      },
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/recommendations/ml')
      .set('Authorization', 'Bearer valid-token')
      .set('x-test-user', 'ml-ok')
      .send({ titles: ['Matrix'], top_n: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('external_ml_api');
    expect(res.body.data.recommendations).toHaveLength(1);
  });

  test('POST /ml returns 503 on external API failure', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('timeout'));

    const app = buildApp();
    const res = await request(app)
      .post('/api/recommendations/ml')
      .set('Authorization', 'Bearer valid-token')
      .set('x-test-user', 'ml-fail')
      .send({ titles: ['Matrix'] });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('timeout'); // upstream error text is not leaked
  });

  test('POST /ml requires a signed-in user and never calls the external service without one', async () => {
    const res = await request(buildApp()).post('/api/recommendations/ml').send({ titles: ['Matrix'] });
    expect(res.status).toBe(401);
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  test('POST /ml is limited per user', async () => {
    mockAxiosPost.mockResolvedValue({ data: { recommendations: [] } });
    const app = buildApp();
    const call = () =>
      request(app)
        .post('/api/recommendations/ml')
        .set('Authorization', 'Bearer valid-token')
        .set('x-test-user', 'ml-spammer')
        .send({ titles: ['Matrix'] });
    let last;
    for (let i = 0; i < 11; i += 1) last = await call();
    expect(last.status).toBe(429);
    const other = await request(app)
      .post('/api/recommendations/ml')
      .set('Authorization', 'Bearer valid-token')
      .set('x-test-user', 'someone-else')
      .send({ titles: ['Matrix'] });
    expect(other.status).toBe(200);
  });

  test('POST /ml allows only 3 slow calls at once, then says busy', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    mockAxiosPost.mockImplementation(() => gate.then(() => ({ data: { recommendations: [] } })));
    const app = buildApp();
    const fire = (uid) =>
      request(app)
        .post('/api/recommendations/ml')
        .set('Authorization', 'Bearer valid-token')
        .set('x-test-user', uid)
        .send({ titles: ['Matrix'] });
    const pending = ['a', 'b', 'c'].map((u) => fire(`busy-${u}`).then((r) => r));
    await new Promise((r) => setTimeout(r, 150)); // let the three start
    const fourth = await fire('busy-d');
    expect(fourth.status).toBe(503);
    expect(fourth.body.error.code).toBe('EXTERNAL_ML_API_BUSY');
    release();
    const done = await Promise.all(pending);
    expect(done.every((r) => r.status === 200)).toBe(true);
    const after = await fire('busy-e'); // slots were freed
    expect(after.status).toBe(200);
  });

  test('POST / with personalize=true without auth returns 401', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/recommendations')
      .send({ media_type: 'movie', tmdb_id: 603, personalize: true });
    if (res.status !== 401) console.log('DEBUG response body:', res.status, res.body);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  test('POST / with personalize=true and valid token returns 200', async () => {
    mockRecoService.getRecommendations.mockResolvedValueOnce({ data: { results: [] }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app)
      .post('/api/recommendations')
      .set('Authorization', 'Bearer valid-token')
      .send({ media_type: 'movie', tmdb_id: 603, personalize: true });

    expect(res.status).toBe(200);
    expect(mockRecoService.getRecommendations).toHaveBeenCalled();
  });
});
