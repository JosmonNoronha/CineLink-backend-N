const request = require('supertest');

const originalEnv = { ...process.env };

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
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.METRICS_SECRET = 'metrics-secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('GET /api/metrics returns Prometheus-formatted metrics', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).get('/api/metrics').set('x-metrics-token', 'metrics-secret');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('cache_hits_total');
    expect(res.text).toContain('cache_misses_total');
  });

  test('GET /api/metrics rejects missing or wrong secret in production', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const missingSecretRes = await request(app).get('/api/metrics');
    const wrongSecretRes = await request(app).get('/api/metrics').set('x-metrics-token', 'wrong');

    expect(missingSecretRes.status).toBe(403);
    expect(wrongSecretRes.status).toBe(403);
  });

  test('GET /api/metrics returns 503 when production secret is missing', async () => {
    process.env.METRICS_SECRET = '';

    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).get('/api/metrics');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Metrics endpoint not configured');
  });
});
