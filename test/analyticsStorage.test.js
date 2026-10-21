const mockGetRedisClient = jest.fn();
const mockIsRedisReady = jest.fn();
const mockGetFirestore = jest.fn();
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

jest.mock('../src/config/redis', () => ({
  getRedisClient: (...args) => mockGetRedisClient(...args),
  isRedisReady: (...args) => mockIsRedisReady(...args),
}));

jest.mock('../src/config/firebase', () => ({
  getFirestore: (...args) => mockGetFirestore(...args),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    warn: (...args) => mockLogger.warn(...args),
    debug: (...args) => mockLogger.debug(...args),
    error: (...args) => mockLogger.error(...args),
  },
}));

const storage = require('../src/services/analytics/storage');

describe('analytics storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    require('../src/services/analytics/buffer').reset();
    require('../src/services/analytics/memoryStore').reset();
  });

  test('storeMetric stores serialized value in redis when ready', async () => {
    const redis = { setEx: jest.fn().mockResolvedValue('OK') };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue(redis);

    const ok = await storage.storeMetric('k1', { a: 1 }, 60);

    expect(ok).toBe(true);
    expect(redis.setEx).toHaveBeenCalledWith('k1', 60, JSON.stringify({ a: 1 }));
  });

  test('storeMetric returns false when redis unavailable or failing', async () => {
    mockIsRedisReady.mockReturnValue(false);
    await expect(storage.storeMetric('k2', 'v')).resolves.toBe(false);

    const redis = { setEx: jest.fn().mockRejectedValue(new Error('boom')) };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue(redis);
    await expect(storage.storeMetric('k2', 'v')).resolves.toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('writes are batched in memory and sent in ONE pipeline', async () => {
    const calls = [];
    const chain = {};
    ['incrBy', 'hIncrBy', 'zIncrBy', 'sAdd', 'expire', 'zRemRangeByRank'].forEach((m) => {
      chain[m] = jest.fn((...a) => { calls.push([m, ...a]); return chain; });
    });
    chain.execAsPipeline = jest.fn().mockResolvedValue([]);
    const redis = { multi: jest.fn(() => chain), incrBy: jest.fn(), hIncrBy: jest.fn() };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue(redis);

    for (let i = 0; i < 100; i += 1) {
      await storage.incrementCounter('total');
      await storage.incrementHashField('status', '200');
      await storage.addToSet('users:today', `u${i % 3}`, 100);
    }
    expect(redis.multi).not.toHaveBeenCalled(); // nothing sent yet: 300 calls cost 0 commands
    expect(redis.incrBy).not.toHaveBeenCalled();

    await storage.flushBuffered();

    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(chain.execAsPipeline).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ['incrBy', 'total', 100],
      ['hIncrBy', 'status', '200', 100],
      ['sAdd', 'users:today', ['u0', 'u1', 'u2']],
      ['expire', 'users:today', 100],
    ]);
  });

  test('a failed flush is kept in memory, not lost', async () => {
    const chain = { incrBy: jest.fn().mockReturnThis(), execAsPipeline: jest.fn().mockRejectedValue(new Error('quota')) };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue({ multi: () => chain });
    await storage.incrementCounter('kept', 5);
    await storage.flushBuffered();

    mockIsRedisReady.mockReturnValue(false);
    await expect(storage.getMetric('kept')).resolves.toBe(5);
  });

  test('getMetric parses json and falls back to raw string', async () => {
    const redis = {
      get: jest
        .fn()
        .mockResolvedValueOnce('{"ok":true}')
        .mockResolvedValueOnce('plain')
        .mockResolvedValueOnce(null),
    };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue(redis);

    await expect(storage.getMetric('json')).resolves.toEqual({ ok: true });
    await expect(storage.getMetric('raw')).resolves.toBe('plain');
    await expect(storage.getMetric('nil')).resolves.toBeNull();
  });

  test('storeEvent and storeAggregatedData write to firestore', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockResolvedValue(undefined);
    const db = {
      collection: jest.fn((name) => {
        if (name === 'analytics_events') return { add };
        if (name === 'analytics_daily') return { doc: jest.fn(() => ({ set })) };
        return {};
      }),
    };
    mockGetFirestore.mockReturnValue(db);

    await expect(storage.storeEvent({ type: 'x' })).resolves.toBe(true);
    await expect(storage.storeAggregatedData('2026-04-23', { req: 1 })).resolves.toBe(true);
    expect(add).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ req: 1 }), { merge: true });
  });

  test('sorted set and hash helpers handle redis ready/not ready', async () => {
    // Without Redis the counters live in memory instead of being dropped.
    mockIsRedisReady.mockReturnValue(false);
    expect(storage.getStorageMode()).toBe('memory');
    await storage.incrementSortedSet('zmem', 'a');
    await storage.incrementSortedSet('zmem', 'a');
    await storage.incrementSortedSet('zmem', 'b');
    await expect(storage.getTopFromSortedSet('zmem', 3)).resolves.toEqual([
      { value: 'a', score: 2 },
      { value: 'b', score: 1 },
    ]);
    await storage.trimSortedSet('zmem', 1);
    await expect(storage.getTopFromSortedSet('zmem', 3)).resolves.toEqual([{ value: 'a', score: 2 }]);
    await storage.incrementHashField('hmem', 'f', 3);
    await expect(storage.getHash('hmem')).resolves.toEqual({ f: '3' });
    await expect(storage.getHash('never-written')).resolves.toEqual({});

    const redis = {
      zAdd: jest.fn().mockResolvedValue(1),
      zIncrBy: jest.fn().mockResolvedValue(2),
      zRemRangeByRank: jest.fn().mockResolvedValue(0),
      zRange: jest.fn().mockResolvedValue([{ value: 'a', score: 1 }]),
      hGetAll: jest.fn().mockResolvedValue({ k: 'v' }),
      hIncrBy: jest.fn().mockResolvedValue(1),
      incrBy: jest.fn().mockResolvedValue(1),
    };
    mockIsRedisReady.mockReturnValue(true);
    expect(storage.getStorageMode()).toBe('redis');
    mockGetRedisClient.mockReturnValue(redis);

    await expect(storage.addToSortedSet('z', 1, 'm')).resolves.toBe(true);
    const chain = {
      zIncrBy: jest.fn().mockReturnThis(),
      zRemRangeByRank: jest.fn().mockReturnThis(),
      hIncrBy: jest.fn().mockReturnThis(),
      incrBy: jest.fn().mockReturnThis(),
      execAsPipeline: jest.fn().mockResolvedValue([]),
    };
    redis.multi = jest.fn(() => chain);
    await expect(storage.incrementSortedSet('z', 'm', 1)).resolves.toBe(true);
    await expect(storage.trimSortedSet('z', 10)).resolves.toBe(true);
    await storage.flushBuffered();
    expect(chain.zIncrBy).toHaveBeenCalledWith('z', 1, 'm');
    expect(chain.zRemRangeByRank).toHaveBeenCalledWith('z', 0, -11);
    await expect(storage.getTopFromSortedSet('z', 3)).resolves.toEqual([{ value: 'a', score: 1 }]);
    await expect(storage.getHash('h')).resolves.toEqual({ k: 'v' });
    await expect(storage.incrementHashField('h', 'f', 2)).resolves.toBe(true);
    await expect(storage.incrementCounter('c', 2)).resolves.toBe(true);
  });
});
