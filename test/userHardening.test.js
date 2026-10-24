require('express-async-errors');
const request = require('supertest');
const express = require('express');

const mockEnsure = jest.fn().mockResolvedValue({});
const mockUpsert = jest.fn().mockResolvedValue({});
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { uid: req.headers['x-uid'] || 'u1', claims: {} };
    next();
  },
  markUserDeleted: jest.fn(),
}));
jest.mock('../src/middleware/rateLimiter', () => ({
  gamificationActionLimiter: (_q, _s, n) => n(),
  accountDeletionLimiter: (_q, _s, n) => n(),
}));
jest.mock('../src/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/user/profile', () => ({
  ensureProfile: (...a) => mockEnsure(...a),
  upsertProfile: (...a) => mockUpsert(...a),
  getProfile: jest.fn().mockResolvedValue({}),
}));
['favorites', 'watchlists', 'episodes', 'gamification', 'accountDeletion'].forEach((m) =>
  jest.mock(`../src/services/user/${m}`, () => ({})),
);

const { errorHandler } = require('../src/middleware/errorHandler');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/user', require('../src/routes/user'));
app.use(errorHandler);

beforeEach(() => {
  mockEnsure.mockClear();
  mockUpsert.mockClear();
});

describe('profile check is remembered', () => {
  test('one Firestore check for repeated requests by the same user', async () => {
    await request(app).get('/api/user/profile').set('x-uid', 'cache-1');
    await request(app).get('/api/user/profile').set('x-uid', 'cache-1');
    await request(app).get('/api/user/profile').set('x-uid', 'cache-1');
    expect(mockEnsure).toHaveBeenCalledTimes(1);
  });

  test('each user is checked on their own', async () => {
    await request(app).get('/api/user/profile').set('x-uid', 'cache-a');
    await request(app).get('/api/user/profile').set('x-uid', 'cache-b');
    expect(mockEnsure).toHaveBeenCalledTimes(2);
  });

  test('a failed check is not remembered', async () => {
    mockEnsure.mockRejectedValueOnce(new Error('firestore down'));
    const bad = await request(app).get('/api/user/profile').set('x-uid', 'cache-fail');
    expect(bad.status).toBe(500);
    const good = await request(app).get('/api/user/profile').set('x-uid', 'cache-fail');
    expect(good.status).toBe(200);
    expect(mockEnsure).toHaveBeenCalledTimes(2);
  });
});

describe('PUT /profile preferences are bounded', () => {
  const put = (body) => request(app).put('/api/user/profile').set('x-uid', 'pref-user').send(body);

  test('normal preferences are accepted', async () => {
    const res = await put({ preferences: { theme: 'dark', genres: [28, 12] } });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
  });

  test('more than 50 keys is rejected', async () => {
    const preferences = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 1]));
    const res = await put({ preferences });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('more than 8 KB is rejected', async () => {
    const res = await put({ preferences: { blob: 'x'.repeat(9000) } });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
