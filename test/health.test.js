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

describe('Health endpoints', () => {
  test('GET /api/health returns healthy', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data.status', 'healthy');
  });

  test('GET /api/status returns environment and uptime', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data.environment');
    expect(res.body).toHaveProperty('data.uptimeSeconds');
  });

  test('Protected route rejects missing token', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).get('/api/user/profile');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error.code', 'UNAUTHORIZED');
  });
});
