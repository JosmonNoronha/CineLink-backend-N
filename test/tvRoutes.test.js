const request = require('supertest');
const express = require('express');

const mockTvService = {
  listPopular: jest.fn(),
  listTopRated: jest.fn(),
  listAiringToday: jest.fn(),
  listOnTheAir: jest.fn(),
  details: jest.fn(),
  season: jest.fn(),
  episode: jest.fn(),
  credits: jest.fn(),
  videos: jest.fn(),
  seasonVideos: jest.fn(),
  images: jest.fn(),
  recommendations: jest.fn(),
  watchProviders: jest.fn(),
};
const mockReviewService = { getTVReviews: jest.fn() };

jest.mock('../src/services/tmdb/tv', () => mockTvService);
jest.mock('../src/services/tmdb/reviews', () => mockReviewService);

const router = require('../src/routes/tv');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tv', router);
  return app;
}

describe('tv routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['/popular?page=1', 'listPopular', [1]],
    ['/top-rated?page=1', 'listTopRated', [1]],
    ['/airing-today?page=1', 'listAiringToday', [1]],
    ['/on-the-air?page=1', 'listOnTheAir', [1]],
    ['/123', 'details', [123]],
    ['/123/season/1', 'season', [123, 1]],
    ['/123/season/1/episode/2', 'episode', [123, 1, 2]],
    ['/123/credits', 'credits', [123]],
    ['/123/videos', 'videos', [123]],
    ['/123/season/1/videos', 'seasonVideos', [123, 1]],
    ['/123/images', 'images', [123]],
    ['/123/recommendations?page=2', 'recommendations', [123, 2]],
    ['/123/watch-providers', 'watchProviders', [123]],
  ])('route %s proxies to %s', async (path, method, args) => {
    mockTvService[method].mockResolvedValueOnce({ data: { ok: true }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app).get(`/api/tv${path}`);

    expect(res.status).toBe(200);
    expect(mockTvService[method]).toHaveBeenCalledWith(...args);
    expect(res.body.meta.source).toBe('tmdb');
  });

  test('/:id/reviews proxies to tv reviews service', async () => {
    mockReviewService.getTVReviews.mockResolvedValueOnce({ data: { results: [] }, source: 'tmdb' });

    const app = buildApp();
    const res = await request(app).get('/api/tv/123/reviews?page=1');

    expect(res.status).toBe(200);
    expect(mockReviewService.getTVReviews).toHaveBeenCalledWith(123, 1);
  });

  test('validation rejects invalid ids', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/tv/not-a-number');

    expect(res.status).toBe(400);
  });
});
