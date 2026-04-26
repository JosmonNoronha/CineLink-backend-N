const mockTrending = jest.fn();
const mockGetTrendingSearchKeywords = jest.fn();
const mockListPopular = jest.fn();
const mockListTopRated = jest.fn();
const mockListPopularTv = jest.fn();
const mockListTopRatedTv = jest.fn();
const mockGetGenreMap = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: (...args) => mockInfo(...args),
    warn: (...args) => mockWarn(...args),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/services/tmdb/trending', () => ({
  trending: (...args) => mockTrending(...args),
  getTrendingSearchKeywords: (...args) => mockGetTrendingSearchKeywords(...args),
}));

jest.mock('../src/services/tmdb/movies', () => ({
  listPopular: (...args) => mockListPopular(...args),
  listTopRated: (...args) => mockListTopRated(...args),
}));

jest.mock('../src/services/tmdb/tv', () => ({
  listPopular: (...args) => mockListPopularTv(...args),
  listTopRated: (...args) => mockListTopRatedTv(...args),
}));

jest.mock('../src/services/tmdb/genres', () => ({
  getGenreMap: (...args) => mockGetGenreMap(...args),
}));

describe('TMDB warmup service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockTrending.mockResolvedValue({ data: { results: [] }, source: 'tmdb' });
    mockGetTrendingSearchKeywords.mockResolvedValue(['action']);
    mockListPopular.mockResolvedValue({ data: { results: [] }, source: 'tmdb' });
    mockListTopRated.mockResolvedValue({ data: { results: [] }, source: 'tmdb' });
    mockListPopularTv.mockResolvedValue({ data: { results: [] }, source: 'tmdb' });
    mockListTopRatedTv.mockResolvedValue({ data: { results: [] }, source: 'tmdb' });
    mockGetGenreMap.mockResolvedValue({ 28: 'Action' });
  });

  test('builds a limited dev warmup plan', () => {
    const { buildWarmupTasks } = require('../src/services/tmdb/warmup');

    const tasks = buildWarmupTasks('dev');
    expect(tasks.map((task) => task.name)).toEqual([
      'trending-movie-week',
      'trending-tv-week',
      'trending-keywords',
      'genre-map-movie',
      'genre-map-tv',
    ]);
  });

  test('warms the full plan and reports success', async () => {
    const { warmupTmdbCaches, resetWarmupState } = require('../src/services/tmdb/warmup');
    resetWarmupState();

    const result = await warmupTmdbCaches({
      enabled: true,
      scope: 'full',
      force: true,
      backoffMs: 25,
      cooldownMs: 100,
    });

    expect(result).toMatchObject({
      enabled: true,
      skipped: false,
      scope: 'full',
      attempted: 9,
      succeeded: 9,
      failed: 0,
    });
    expect(mockTrending).toHaveBeenNthCalledWith(1, 'movie', 'week');
    expect(mockTrending).toHaveBeenNthCalledWith(2, 'tv', 'week');
    expect(mockListPopular).toHaveBeenCalledWith(1);
    expect(mockListTopRated).toHaveBeenCalledWith(1);
    expect(mockListPopularTv).toHaveBeenCalledWith(1);
    expect(mockListTopRatedTv).toHaveBeenCalledWith(1);
    expect(mockGetGenreMap).toHaveBeenNthCalledWith(1, 'movie');
    expect(mockGetGenreMap).toHaveBeenNthCalledWith(2, 'tv');
  });

  test('applies cooldown after a failed warmup attempt', async () => {
    const { warmupTmdbCaches, resetWarmupState } = require('../src/services/tmdb/warmup');
    resetWarmupState();
    mockGetGenreMap.mockRejectedValueOnce(new Error('genre cache down'));

    const first = await warmupTmdbCaches({
      enabled: true,
      scope: 'dev',
      force: true,
      backoffMs: 25,
      cooldownMs: 1000,
    });

    expect(first.failed).toBeGreaterThan(0);
    expect(first.nextAllowedAt).toBeGreaterThan(Date.now());

    const second = await warmupTmdbCaches({
      enabled: true,
      scope: 'dev',
      backoffMs: 25,
      cooldownMs: 1000,
    });

    expect(second.skipped).toBe(true);
    expect(second.attempted).toBe(0);
  });
});
