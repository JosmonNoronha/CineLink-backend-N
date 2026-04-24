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
jest.mock('../src/utils/logger', () => ({ logger: { error: (...args) => mockLoggerError(...args) } }));

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
      .send({ titles: ['Matrix'] });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });
});
