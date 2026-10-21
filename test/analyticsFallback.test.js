// The admin Overview used to be empty whenever Redis was missing (the metrics middleware returned early
// and every storage helper did nothing). This runs real requests through the real middleware with Redis
// OFF and reads the numbers back through the same service the /analytics routes use.
const request = require('supertest');
const express = require('express');

jest.mock('../src/config/redis', () => ({ isRedisReady: () => false, getRedisClient: () => null }));
jest.mock('../src/config/firebase', () => ({ getFirestore: () => ({}) }));
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { createMetricsMiddleware, analyticsMiddleware } = require('../src/middleware/metrics');
const { analyticsService } = require('../src/services/analytics');
const mem = require('../src/services/analytics/memoryStore');

const buildApp = () => {
  const app = express();
  app.use(createMetricsMiddleware());
  app.use(analyticsMiddleware);
  app.use((req, _res, next) => {
    if (req.headers['x-uid']) req.user = { uid: req.headers['x-uid'] };
    next();
  });
  app.get('/api/movies/:id', async (req, res) => {
    await req.analytics.trackMovieView(req.params.id, `Movie ${req.params.id}`);
    res.json({ ok: true });
  });
  app.get('/api/search', async (req, res) => {
    await req.analytics.trackSearch(req.query.q);
    res.json({ ok: true });
  });
  app.get('/api/boom', (_req, res) => res.status(500).json({ error: 'x' }));
  return app;
};

// the metrics middleware records after the response is sent
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('analytics without Redis', () => {
  beforeEach(() => mem.reset());

  test('requests, errors, status codes, active users, searches and views all show up', async () => {
    const app = buildApp();
    await request(app).get('/api/movies/603').set('x-uid', 'u1').expect(200);
    await request(app).get('/api/movies/603').set('x-uid', 'u2').expect(200);
    await request(app).get('/api/movies/604').set('x-uid', 'u1').expect(200);
    await request(app).get('/api/search?q=The%20Matrix').expect(200);
    await request(app).get('/api/search?q=the matrix').expect(200);
    await request(app).get('/api/boom').expect(500);
    await settle();

    const overview = await analyticsService.getOverview();
    expect(overview.storage).toBe('memory');
    expect(overview.totalRequests).toBe(6);
    expect(overview.totalErrors).toBe(1);
    expect(overview.statusCodes).toEqual({ 200: '5', 500: '1' });

    expect((await analyticsService.getUserEngagement()).activeUsersToday).toBe(2);

    const perf = await analyticsService.getPerformanceMetrics();
    expect(perf['GET:/api/movies/:id']).toMatchObject({ requests: 3, errors: 0 });
    expect(perf['GET:/api/boom']).toMatchObject({ requests: 1, errors: 1, errorRate: '100.00' });

    expect(await analyticsService.getPopularSearches(5)).toEqual([{ query: 'the matrix', score: 2 }]);
    const { movies } = await analyticsService.getPopularContent(5);
    expect(movies[0]).toMatchObject({ id: '603', title: 'Movie 603', views: 2 });
    expect(movies[1]).toMatchObject({ id: '604', views: 1 });
  });

  test('random URLs share one label, so bots cannot grow memory', async () => {
    const app = buildApp();
    for (let i = 0; i < 40; i += 1) await request(app).get(`/wp-admin/${i}.php`).expect(404);
    await settle();

    const perf = await analyticsService.getPerformanceMetrics();
    expect(Object.keys(perf)).toEqual(['GET:unmatched']);
    expect(perf['GET:unmatched'].requests).toBe(40);
  });

  test('memory store is bounded', () => {
    for (let i = 0; i < 700; i += 1) mem.incrementHashField('h', `field-${i}`);
    expect(Object.keys(mem.getHash('h')).length).toBeLessThanOrEqual(501); // 500 fields + the overflow bucket
    for (let i = 0; i < 6000; i += 1) mem.zIncr('z', `m-${i}`);
    expect(mem.zTop('z', 10000).length).toBeLessThanOrEqual(5000);
  });
});
