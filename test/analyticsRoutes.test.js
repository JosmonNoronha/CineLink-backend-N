require('express-async-errors');

const request = require('supertest');
const express = require('express');

const mockGetOverview = jest.fn();
const mockGetUserEngagement = jest.fn();
const mockGetPopularSearches = jest.fn();
const mockGetPopularContent = jest.fn();
const mockGetPerformanceMetrics = jest.fn();
const mockLoggerError = jest.fn();
const { errorHandler } = require('../src/middleware/errorHandler');

jest.mock('../src/services/analytics', () => ({
  analyticsService: {
    getOverview: (...args) => mockGetOverview(...args),
    getUserEngagement: (...args) => mockGetUserEngagement(...args),
    getPopularSearches: (...args) => mockGetPopularSearches(...args),
    getPopularContent: (...args) => mockGetPopularContent(...args),
    getPerformanceMetrics: (...args) => mockGetPerformanceMetrics(...args),
  },
}));

jest.mock('../src/middleware/auth', () => ({
  optionalAuth: (_req, _res, next) => next(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: (...args) => mockLoggerError(...args),
  },
}));

const analyticsRouter = require('../src/routes/analytics');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  app.use(errorHandler);
  return app;
}

describe('analytics routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /overview returns overview with engagement and timestamp', async () => {
    mockGetOverview.mockResolvedValueOnce({ totalRequests: 10 });
    mockGetUserEngagement.mockResolvedValueOnce({ activeUsersToday: 5 });

    const app = buildApp();
    const res = await request(app).get('/api/analytics/overview');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalRequests: 10,
      engagement: { activeUsersToday: 5 },
    });
    expect(typeof res.body.data.timestamp).toBe('string');
  });

  test('GET /popular-searches uses default and explicit limits', async () => {
    mockGetPopularSearches
      .mockResolvedValueOnce([{ query: 'matrix', score: 10 }])
      .mockResolvedValueOnce([{ query: 'dune', score: 9 }]);

    const app = buildApp();
    const defaultRes = await request(app).get('/api/analytics/popular-searches');
    const explicitRes = await request(app).get('/api/analytics/popular-searches?limit=3');

    expect(defaultRes.status).toBe(200);
    expect(explicitRes.status).toBe(200);
    expect(mockGetPopularSearches).toHaveBeenNthCalledWith(1, 10);
    expect(mockGetPopularSearches).toHaveBeenNthCalledWith(2, 3);
    expect(defaultRes.body.data.count).toBe(1);
  });

  test('GET /popular-content, /user-engagement, /performance return analytics payloads', async () => {
    mockGetPopularContent.mockResolvedValueOnce({ movies: [{ id: 'm1' }], tvShows: [{ id: 't1' }] });
    mockGetUserEngagement.mockResolvedValueOnce({ activeUsersToday: 7 });
    mockGetPerformanceMetrics.mockResolvedValueOnce({ 'GET:/api/search': { requests: 5 } });

    const app = buildApp();
    const contentRes = await request(app).get('/api/analytics/popular-content?limit=2');
    const engagementRes = await request(app).get('/api/analytics/user-engagement');
    const perfRes = await request(app).get('/api/analytics/performance');

    expect(contentRes.status).toBe(200);
    expect(engagementRes.status).toBe(200);
    expect(perfRes.status).toBe(200);

    expect(mockGetPopularContent).toHaveBeenCalledWith(2);
    expect(contentRes.body.data).toMatchObject({ movies: [{ id: 'm1' }], tvShows: [{ id: 't1' }] });
    expect(engagementRes.body.data).toMatchObject({ activeUsersToday: 7 });
    expect(perfRes.body.data.endpoints).toMatchObject({ 'GET:/api/search': { requests: 5 } });
    expect(typeof perfRes.body.data.timestamp).toBe('string');
  });

  test('returns 500 with ANALYTICS_ERROR envelope on service failure', async () => {
    mockGetOverview.mockRejectedValueOnce(new Error('analytics down'));

    const app = buildApp();
    const res = await request(app).get('/api/analytics/overview');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
      },
    });
    expect(mockLoggerError).toHaveBeenCalled();
  });
});
