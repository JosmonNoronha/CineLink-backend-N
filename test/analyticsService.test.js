const mockCreateEvent = jest.fn();
const mockValidateEvent = jest.fn();
const mockStoreEvent = jest.fn();
const mockGetOverviewMetrics = jest.fn();
const mockGetPopularSearches = jest.fn();
const mockGetPopularMovies = jest.fn();
const mockGetPopularTVShows = jest.fn();
const mockGetActiveUsersCount = jest.fn();
const mockGetPerformanceMetrics = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();

jest.mock('../src/services/analytics/events', () => ({
  EventTypes: { SEARCH_QUERY: 'search.query' },
  EventCategories: { SEARCH: 'search' },
  createEvent: (...args) => mockCreateEvent(...args),
  validateEvent: (...args) => mockValidateEvent(...args),
}));

jest.mock('../src/services/analytics/storage', () => ({
  storeEvent: (...args) => mockStoreEvent(...args),
}));

jest.mock('../src/services/analytics/metrics', () => ({
  getOverviewMetrics: (...args) => mockGetOverviewMetrics(...args),
  getPopularSearches: (...args) => mockGetPopularSearches(...args),
  getPopularMovies: (...args) => mockGetPopularMovies(...args),
  getPopularTVShows: (...args) => mockGetPopularTVShows(...args),
  getActiveUsersCount: (...args) => mockGetActiveUsersCount(...args),
  getPerformanceMetrics: (...args) => mockGetPerformanceMetrics(...args),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: (...args) => mockLoggerInfo(...args),
    error: (...args) => mockLoggerError(...args),
    debug: (...args) => mockLoggerDebug(...args),
  },
}));

const { analyticsService } = require('../src/services/analytics');

describe('analytics service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService.eventQueue = [];
    analyticsService.isProcessing = false;
    if (analyticsService.flushInterval) {
      clearInterval(analyticsService.flushInterval);
      analyticsService.flushInterval = null;
    }
  });

  afterEach(() => {
    if (analyticsService.flushInterval) {
      clearInterval(analyticsService.flushInterval);
      analyticsService.flushInterval = null;
    }
  });

  test('initialize schedules periodic flush and shutdown clears it', async () => {
    jest.useFakeTimers();
    const flushSpy = jest.spyOn(analyticsService, 'flushEvents').mockResolvedValue(undefined);

    analyticsService.initialize();
    jest.advanceTimersByTime(30000);

    expect(flushSpy).toHaveBeenCalled();

    await analyticsService.shutdown();
    expect(mockLoggerInfo).toHaveBeenCalled();

    flushSpy.mockRestore();
    jest.useRealTimers();
  });

  test('trackEvent queues valid events and handles failures', () => {
    mockCreateEvent.mockReturnValue({ type: 'search.query', timestamp: Date.now(), data: {}, metadata: {} });
    mockValidateEvent.mockImplementation(() => true);

    expect(analyticsService.trackEvent('search.query', { q: 'matrix' }, { u: '1' })).toBe(true);
    expect(analyticsService.eventQueue).toHaveLength(1);

    mockCreateEvent.mockImplementationOnce(() => {
      throw new Error('bad event');
    });
    expect(analyticsService.trackEvent('search.query')).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  test('trackEvent flushes when queue reaches threshold', () => {
    const flushSpy = jest.spyOn(analyticsService, 'flushEvents').mockResolvedValue(undefined);
    analyticsService.eventQueue = Array.from({ length: 99 }, (_, i) => ({ i }));
    mockCreateEvent.mockReturnValue({ type: 'search.query', timestamp: Date.now(), data: {}, metadata: {} });
    mockValidateEvent.mockImplementation(() => true);

    analyticsService.trackEvent('search.query');

    expect(flushSpy).toHaveBeenCalled();
    flushSpy.mockRestore();
  });

  test('flushEvents batches and stores events', async () => {
    analyticsService.eventQueue = Array.from({ length: 55 }, (_, i) => ({ id: i }));
    mockStoreEvent.mockResolvedValue(true);

    await analyticsService.flushEvents();

    expect(mockStoreEvent).toHaveBeenCalledTimes(55);
    expect(analyticsService.eventQueue).toHaveLength(0);
    expect(analyticsService.isProcessing).toBe(false);
  });

  test('flushEvents requeues on storage failures', async () => {
    analyticsService.eventQueue = [{ id: 1 }, { id: 2 }];
    mockStoreEvent.mockRejectedValue(new Error('store failed'));

    await analyticsService.flushEvents();

    expect(analyticsService.eventQueue).toHaveLength(2);
    expect(mockLoggerError).toHaveBeenCalled();
    expect(analyticsService.isProcessing).toBe(false);
  });

  test('read APIs proxy to metrics service', async () => {
    mockGetOverviewMetrics.mockResolvedValue({ totalRequests: 10 });
    mockGetPopularSearches.mockResolvedValue([{ query: 'matrix' }]);
    mockGetPopularMovies.mockResolvedValue([{ id: 'm1' }]);
    mockGetPopularTVShows.mockResolvedValue([{ id: 't1' }]);
    mockGetActiveUsersCount.mockResolvedValue(5);
    mockGetPerformanceMetrics.mockResolvedValue({});

    await expect(analyticsService.getOverview()).resolves.toEqual({ totalRequests: 10 });
    await expect(analyticsService.getPopularSearches(5)).resolves.toEqual([{ query: 'matrix' }]);
    await expect(analyticsService.getPopularContent(3)).resolves.toEqual({
      movies: [{ id: 'm1' }],
      tvShows: [{ id: 't1' }],
    });
    await expect(analyticsService.getUserEngagement()).resolves.toEqual({ activeUsersToday: 5 });
    await expect(analyticsService.getPerformanceMetrics()).resolves.toEqual({});
  });
});
