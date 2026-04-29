const mockGetRedisClient = jest.fn();
const mockIsRedisReady = jest.fn();
const mockMarkRedisUnavailable = jest.fn();
const mockLoggerWarn = jest.fn();
const mockCacheHitInc = jest.fn();
const mockCacheMissInc = jest.fn();

jest.mock('../src/config/redis', () => ({
  getRedisClient: (...args) => mockGetRedisClient(...args),
  isRedisReady: (...args) => mockIsRedisReady(...args),
  markRedisUnavailable: (...args) => mockMarkRedisUnavailable(...args),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    warn: (...args) => mockLoggerWarn(...args),
  },
}));

jest.mock('../src/routes/metrics', () => ({
  cacheHitRate: {
    inc: (...args) => mockCacheHitInc(...args),
  },
  cacheMissRate: {
    inc: (...args) => mockCacheMissInc(...args),
  },
}));

const { cacheGet, cacheSet, getCacheStats } = require('../src/services/tmdb/cache');

describe('tmdb cache service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reads and writes via redis when available', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
      set: jest.fn().mockResolvedValue('OK'),
    };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockResolvedValue(redis);

    await cacheSet('tmdb:key:1', { ok: true }, 60);
    const hit = await cacheGet('tmdb:key:1');

    expect(redis.set).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ ok: true }), { EX: 60 });
    expect(redis.get).toHaveBeenCalledWith(expect.any(String));
    expect(hit).toEqual({ ok: true });
    expect(mockCacheHitInc).toHaveBeenCalledWith({ cache_type: 'redis' });
  });

  test('uses memory fallback when redis is not ready', async () => {
    mockIsRedisReady.mockReturnValue(false);

    await cacheSet('tmdb:key:memory', { value: 1 }, 60);
    const hit = await cacheGet('tmdb:key:memory');

    expect(hit).toEqual({ value: 1 });
    expect(mockGetRedisClient).not.toHaveBeenCalled();
    expect(mockCacheHitInc).toHaveBeenCalledWith({ cache_type: 'memory' });
  });

  test('expires memory entries by ttl', async () => {
    mockIsRedisReady.mockReturnValue(false);

    await cacheSet('tmdb:key:ttl', { v: 2 }, 1);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const hit = await cacheGet('tmdb:key:ttl');
    expect(hit).toBeNull();
    expect(mockCacheMissInc).toHaveBeenCalledWith({ cache_type: 'memory' });
  });

  test('marks redis unavailable on redis errors and falls back to memory', async () => {
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockResolvedValue(redis);

    await cacheSet('tmdb:key:error', { v: 3 }, 60);
    const hit = await cacheGet('tmdb:key:error');

    expect(mockMarkRedisUnavailable).toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    expect(hit).toEqual({ v: 3 });
  });

  test('bounds in-memory cache size and evicts older entries', async () => {
    mockIsRedisReady.mockReturnValue(false);

    for (let i = 0; i < 600; i += 1) {
      await cacheSet(`tmdb:key:${i}`, { index: i }, 60);
    }

    const stats = getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(500);
    expect(stats.calculatedSize).toBeLessThanOrEqual(50 * 1024 * 1024);

    const oldest = await cacheGet('tmdb:key:0');
    const newest = await cacheGet('tmdb:key:599');

    expect(oldest).toBeNull();
    expect(newest).toEqual({ index: 599 });
  });
});
