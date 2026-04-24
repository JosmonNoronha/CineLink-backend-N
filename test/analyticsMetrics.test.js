const mockIncrementCounter = jest.fn();
const mockIncrementHashField = jest.fn();
const mockAddToSortedSet = jest.fn();
const mockGetMetric = jest.fn();
const mockGetHash = jest.fn();
const mockGetTopFromSortedSet = jest.fn();
const mockGetRedisClient = jest.fn();
const mockIsRedisReady = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../src/services/analytics/storage', () => ({
  incrementCounter: (...args) => mockIncrementCounter(...args),
  incrementHashField: (...args) => mockIncrementHashField(...args),
  addToSortedSet: (...args) => mockAddToSortedSet(...args),
  getMetric: (...args) => mockGetMetric(...args),
  getHash: (...args) => mockGetHash(...args),
  getTopFromSortedSet: (...args) => mockGetTopFromSortedSet(...args),
}));

jest.mock('../src/config/redis', () => ({
  getRedisClient: (...args) => mockGetRedisClient(...args),
  isRedisReady: (...args) => mockIsRedisReady(...args),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    warn: (...args) => mockLoggerWarn(...args),
    error: (...args) => mockLoggerError(...args),
  },
}));

const metrics = require('../src/services/analytics/metrics');

describe('analytics metrics service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('trackRequest increments counters and tracks active user', async () => {
    const redis = { sAdd: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue(redis);

    await metrics.trackRequest('/api/search', 'GET', 200, 120, 'u1');

    expect(mockIncrementCounter).toHaveBeenCalled();
    expect(mockIncrementHashField).toHaveBeenCalled();
    expect(redis.sAdd).toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalled();
  });

  test('trackError records endpoint error and logs warning', async () => {
    await metrics.trackError('/api/search', 'POST', new Error('boom'));
    expect(mockIncrementCounter).toHaveBeenCalled();
    expect(mockIncrementHashField).toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  test('trackSearch, trackMovieView, trackTVView, cache hit/miss call storage adapters', async () => {
    await metrics.trackSearch('matrix', 'u1');
    await metrics.trackMovieView('m1', 'Movie One');
    await metrics.trackTVView('t1', 'TV One');
    await metrics.trackCacheHit();
    await metrics.trackCacheMiss();

    expect(mockAddToSortedSet).toHaveBeenCalled();
    expect(mockIncrementCounter).toHaveBeenCalled();
  });

  test('getOverviewMetrics computes rates with defaults', async () => {
    mockGetMetric
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('80')
      .mockResolvedValueOnce('20');
    mockGetHash
      .mockResolvedValueOnce({ 'GET:/api/search': '10' })
      .mockResolvedValueOnce({ 200: '95', 500: '5' });

    const data = await metrics.getOverviewMetrics();

    expect(data.totalRequests).toBe(100);
    expect(data.totalErrors).toBe(5);
    expect(data.errorRate).toBe('5.00');
    expect(data.cache.hitRate).toBe('80.00');
  });

  test('popular search/movie/tv formatters parse values and fallback safely', async () => {
    mockGetTopFromSortedSet
      .mockResolvedValueOnce([{ value: 'matrix', score: 10 }])
      .mockResolvedValueOnce([{ value: '{"id":"m1","title":"Movie"}', score: 22 }])
      .mockResolvedValueOnce([{ value: 'not-json', score: 5 }]);

    const searches = await metrics.getPopularSearches(1);
    const movies = await metrics.getPopularMovies(1);
    const tv = await metrics.getPopularTVShows(1);

    expect(searches).toEqual([{ query: 'matrix', score: 10 }]);
    expect(movies[0]).toMatchObject({ id: 'm1', views: 22 });
    expect(tv[0]).toMatchObject({ data: 'not-json', views: 5 });
  });

  test('getActiveUsersCount handles redis unavailable and error', async () => {
    mockIsRedisReady.mockReturnValue(false);
    await expect(metrics.getActiveUsersCount()).resolves.toBe(0);

    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisClient.mockReturnValue({ sCard: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(metrics.getActiveUsersCount()).resolves.toBe(0);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  test('getPerformanceMetrics computes averages and error rates', async () => {
    mockGetHash
      .mockResolvedValueOnce({ 'GET:/x': '5' })
      .mockResolvedValueOnce({ 'GET:/x': '250' })
      .mockResolvedValueOnce({ 'GET:/x': '1' });

    const perf = await metrics.getPerformanceMetrics();

    expect(perf['GET:/x']).toMatchObject({
      requests: 5,
      averageResponseTime: '50.00',
      errors: 1,
      errorRate: '20.00',
    });
  });
});
