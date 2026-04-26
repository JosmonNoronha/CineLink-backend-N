const request = require('supertest');
const mockWarmupTmdbCaches = jest.fn();

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

jest.mock('../src/services/tmdb/warmup', () => ({
  warmupTmdbCaches: (...args) => mockWarmupTmdbCaches(...args),
}));

describe('App TMDB warmup startup', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.STATUS_MONITOR_ENABLED = 'false';
    process.env.TMDB_WARMUP_ENABLED = 'true';
    process.env.TMDB_WARMUP_SCOPE = 'dev';
    process.env.TMDB_WARMUP_BACKOFF_MS = '25';
    process.env.TMDB_WARMUP_COOLDOWN_MS = '100';
    process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
    process.env.FIREBASE_PRIVATE_KEY = 'test-key';
  });

  test('calls warmup during createApp startup', async () => {
    mockWarmupTmdbCaches.mockResolvedValue({
      enabled: true,
      skipped: false,
      scope: 'dev',
      attempted: 5,
      succeeded: 5,
      failed: 0,
    });

    const { createApp } = require('../src/app');
    const app = await createApp();

    expect(app).toBeDefined();
    expect(mockWarmupTmdbCaches).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        scope: 'dev',
        backoffMs: 25,
        cooldownMs: 100,
      })
    );
  });
});
