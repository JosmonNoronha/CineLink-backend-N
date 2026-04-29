const request = require('supertest');

jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn().mockResolvedValue({
    auth: () => ({ listUsers: jest.fn().mockResolvedValue({ users: [] }) }),
    firestore: () => ({}),
  }),
  warmupJwtVerification: jest.fn().mockResolvedValue(undefined),
  warmupFirestore: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/config/redis', () => ({
  initializeRedis: jest.fn().mockResolvedValue(null),
  getRedisClient: jest.fn().mockReturnValue(null),
  isRedisReady: jest.fn().mockReturnValue(false),
  markRedisUnavailable: jest.fn(),
}));

jest.mock('../src/services/analytics', () => ({
  analyticsService: {
    initialize: jest.fn(),
  },
}));

jest.setTimeout(45_000);

describe('Metrics endpoint', () => {
  test('GET /api/metrics returns Prometheus-formatted metrics', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).get('/api/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('cache_hits_total');
    expect(res.text).toContain('cache_misses_total');
  });
});
