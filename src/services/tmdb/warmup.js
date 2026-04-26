const { logger } = require('../../utils/logger');
const trendingService = require('./trending');
const movieService = require('./movies');
const tvService = require('./tv');
const { getGenreMap } = require('./genres');

const DEFAULT_SCOPE = 'dev';
const warmupState = {
  failureCount: 0,
  nextAllowedAt: 0,
  lastAttemptAt: 0,
};

function getDelayMs(baseDelayMs, failureCount, maxDelayMs) {
  const multiplier = Math.max(0, failureCount - 1);
  return Math.min(maxDelayMs, baseDelayMs * (2 ** multiplier));
}

function isWarmupEnabled(enabled) {
  return Boolean(enabled);
}

function buildWarmupTasks(scope = DEFAULT_SCOPE) {
  const baseTasks = [
    {
      name: 'trending-movie-week',
      run: () => trendingService.trending('movie', 'week'),
    },
    {
      name: 'trending-tv-week',
      run: () => trendingService.trending('tv', 'week'),
    },
    {
      name: 'trending-keywords',
      run: () => trendingService.getTrendingSearchKeywords(),
    },
    {
      name: 'genre-map-movie',
      run: () => getGenreMap('movie'),
    },
    {
      name: 'genre-map-tv',
      run: () => getGenreMap('tv'),
    },
  ];

  if (scope === 'minimal') {
    return baseTasks.slice(0, 3);
  }

  if (scope === 'dev') {
    return baseTasks;
  }

  return [
    ...baseTasks,
    {
      name: 'movie-popular',
      run: () => movieService.listPopular(1),
    },
    {
      name: 'movie-top-rated',
      run: () => movieService.listTopRated(1),
    },
    {
      name: 'tv-popular',
      run: () => tvService.listPopular(1),
    },
    {
      name: 'tv-top-rated',
      run: () => tvService.listTopRated(1),
    },
  ];
}

async function warmupTmdbCaches(options = {}) {
  const {
    enabled = true,
    scope = DEFAULT_SCOPE,
    force = false,
    backoffMs = 5000,
    cooldownMs = 60000,
  } = options;

  const now = Date.now();
  const normalizedScope = scope || DEFAULT_SCOPE;
  const cooldownUntil = warmupState.nextAllowedAt;

  if (!isWarmupEnabled(enabled)) {
    logger.info('TMDB warmup skipped because it is disabled', {
      warmupScope: normalizedScope,
    });
    return {
      enabled: false,
      skipped: true,
      scope: normalizedScope,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      nextAllowedAt: warmupState.nextAllowedAt,
    };
  }

  if (!force && cooldownUntil && now < cooldownUntil) {
    const waitMs = cooldownUntil - now;
    logger.info('TMDB warmup skipped due to cooldown', {
      warmupScope: normalizedScope,
      waitMs,
      nextAllowedAt: cooldownUntil,
    });
    return {
      enabled: true,
      skipped: true,
      scope: normalizedScope,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      nextAllowedAt: cooldownUntil,
    };
  }

  warmupState.lastAttemptAt = now;
  const tasks = buildWarmupTasks(normalizedScope);
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const startedAt = Date.now();
      try {
        await task.run();
        logger.info('TMDB warmup task completed', {
          warmupScope: normalizedScope,
          warmupTask: task.name,
          durationMs: Date.now() - startedAt,
        });
        return { task: task.name, ok: true };
      } catch (error) {
        logger.warn('TMDB warmup task failed', {
          warmupScope: normalizedScope,
          warmupTask: task.name,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
        return { task: task.name, ok: false, error: error.message };
      }
    })
  );

  const succeeded = results.filter((result) => result.status === 'fulfilled' && result.value.ok).length;
  const failed = results.length - succeeded;

  if (failed > 0) {
    warmupState.failureCount += 1;
    const delayMs = getDelayMs(backoffMs, warmupState.failureCount, cooldownMs);
    warmupState.nextAllowedAt = now + delayMs;
    logger.warn('TMDB warmup finished with failures; cooldown applied', {
      warmupScope: normalizedScope,
      attempts: results.length,
      succeeded,
      failed,
      failureCount: warmupState.failureCount,
      nextAllowedAt: warmupState.nextAllowedAt,
      cooldownMs,
    });
  } else {
    warmupState.failureCount = 0;
    warmupState.nextAllowedAt = 0;
    logger.info('TMDB warmup completed successfully', {
      warmupScope: normalizedScope,
      attempts: results.length,
      succeeded,
      failed,
    });
  }

  return {
    enabled: true,
    skipped: false,
    scope: normalizedScope,
    attempted: results.length,
    succeeded,
    failed,
    nextAllowedAt: warmupState.nextAllowedAt,
  };
}

function resetWarmupState() {
  warmupState.failureCount = 0;
  warmupState.nextAllowedAt = 0;
  warmupState.lastAttemptAt = 0;
}

module.exports = {
  buildWarmupTasks,
  resetWarmupState,
  warmupTmdbCaches,
};
