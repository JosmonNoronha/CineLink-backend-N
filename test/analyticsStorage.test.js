const mockGetRedisClient = jest.fn();
const mockIsRedisReady = jest.fn();
const mockGetFirestore = jest.fn();
const mockLogger = {
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
    debug: (...args) => mockLogger.debug(...args),
    error: (...args) => mockLogger.error(...args),
  },
}));

const storage = require('../src/services/analytics/storage');

describe('analytics storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  test('incrementCounter and incrementHashField guard missing redis capabilities', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue({});

    await expect(storage.incrementCounter('ctr')).resolves.toBe(false);
    await expect(storage.incrementHashField('h', 'f')).resolves.toBe(false);
    expect(mockLogger.debug).toHaveBeenCalled();
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
    mockIsRedisReady.mockReturnValue(false);
    await expect(storage.addToSortedSet('z', 1, 'm')).resolves.toBe(false);
    await expect(storage.getTopFromSortedSet('z', 3)).resolves.toEqual([]);
    await expect(storage.getHash('h')).resolves.toEqual({});

    const redis = {
      zAdd: jest.fn().mockResolvedValue(1),
      zRange: jest.fn().mockResolvedValue([{ value: 'a', score: 1 }]),
      hGetAll: jest.fn().mockResolvedValue({ k: 'v' }),
      hIncrBy: jest.fn().mockResolvedValue(1),
      incrBy: jest.fn().mockResolvedValue(1),
    };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue(redis);

    await expect(storage.addToSortedSet('z', 1, 'm')).resolves.toBe(true);
    await expect(storage.getTopFromSortedSet('z', 3)).resolves.toEqual([{ value: 'a', score: 1 }]);
    await expect(storage.getHash('h')).resolves.toEqual({ k: 'v' });
    await expect(storage.incrementHashField('h', 'f', 2)).resolves.toBe(true);
    await expect(storage.incrementCounter('c', 2)).resolves.toBe(true);
  });
});
