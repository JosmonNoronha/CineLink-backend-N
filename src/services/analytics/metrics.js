const { incrementCounter, incrementHashField, addToSortedSet, getMetric, getHash, getTopFromSortedSet } = require('./storage');
const { logger } = require('../../utils/logger');

// Metric key builders
const keys = {
  totalRequests: () => 'metrics:requests:total',
  totalErrors: () => 'metrics:errors:total',
  requestsByEndpoint: () => 'metrics:requests:by_endpoint',
  errorsByEndpoint: () => 'metrics:errors:by_endpoint',
  responseTimesByEndpoint: () => 'metrics:response_times:by_endpoint',
  statusCodes: () => 'metrics:status_codes',
  activeUsers: () => 'metrics:active_users',
  popularSearches: () => 'metrics:popular_searches',
  popularMovies: () => 'metrics:popular_movies',
  popularTVShows: () => 'metrics:popular_tv',
  cacheHits: () => 'metrics:cache:hits',
  cacheMisses: () => 'metrics:cache:misses',
  requestsPerHour: (hour) => `metrics:requests:hour:${hour}`,
  requestsPerDay: (day) => `metrics:requests:day:${day}`,
};

/**
 * Track API request
 */
async function trackRequest(endpoint, method, statusCode, responseTime, userId = null) {
  const endpointKey = `${method}:${endpoint}`;
  
  await Promise.all([
    incrementCounter(keys.totalRequests()),
    incrementHashField(keys.requestsByEndpoint(), endpointKey),
    incrementHashField(keys.statusCodes(), String(statusCode)),
    incrementHashField(keys.responseTimesByEndpoint(), endpointKey, responseTime),
  ]);

  // Track hourly metrics
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  await incrementCounter(keys.requestsPerHour(hour));

  // Track daily metrics
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await incrementCounter(keys.requestsPerDay(day));

  if (userId) {
    await trackActiveUser(userId);
  }
}

/**
 * Track API error
 */
async function trackError(endpoint, method, error) {
  const endpointKey = `${method}:${endpoint}`;
  
  await Promise.all([
    incrementCounter(keys.totalErrors()),
    incrementHashField(keys.errorsByEndpoint(), endpointKey),
  ]);

  logger.warn('API error tracked', { endpoint, method, error: error.message });
}

/**
 * Track active user
 */
async function trackActiveUser(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${keys.activeUsers()}:${today}`;
  
  // Use set to track unique users
  const { getRedisClient, isRedisReady } = require('../../config/redis');
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      await redis.sAdd(key, userId);
      await redis.expire(key, 604800); // 7 days TTL
    } catch (error) {
      logger.error('Failed to track active user', { error: error.message });
    }
  }
}

/**
 * Track search query
 */
async function trackSearch(query, userId = null) {
  await addToSortedSet(keys.popularSearches(), Date.now(), query);
  
  if (userId) {
    await trackActiveUser(userId);
  }
}

/**
 * Track movie view
 */
async function trackMovieView(movieId, title, userId = null) {
  const movieData = JSON.stringify({ id: movieId, title });
  await addToSortedSet(keys.popularMovies(), Date.now(), movieData);
  
  if (userId) {
    await trackActiveUser(userId);
  }
}

/**
 * Track TV show view
 */
async function trackTVView(tvId, title, userId = null) {
  const tvData = JSON.stringify({ id: tvId, title });
  await addToSortedSet(keys.popularTVShows(), tvId, tvData);
  
  if (userId) {
    await trackActiveUser(userId);
  }
}

/**
 * Track cache hit
 */
async function trackCacheHit() {
  await incrementCounter(keys.cacheHits());
}

/**
 * Track cache miss
 */
async function trackCacheMiss() {
  await incrementCounter(keys.cacheMisses());
}

/**
 * Get overview metrics
 */
async function getOverviewMetrics() {
  const [
    totalRequests,
    totalErrors,
    requestsByEndpoint,
    statusCodes,
    cacheHits,
    cacheMisses,
  ] = await Promise.all([
    getMetric(keys.totalRequests()),
    getMetric(keys.totalErrors()),
    getHash(keys.requestsByEndpoint()),
    getHash(keys.statusCodes()),
    getMetric(keys.cacheHits()),
    getMetric(keys.cacheMisses()),
  ]);

  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const cacheHitRate =
    cacheHits + cacheMisses > 0 ? (cacheHits / (cacheHits + cacheMisses)) * 100 : 0;

  return {
    totalRequests: parseInt(totalRequests) || 0,
    totalErrors: parseInt(totalErrors) || 0,
    errorRate: errorRate.toFixed(2),
    requestsByEndpoint,
    statusCodes,
    cache: {
      hits: parseInt(cacheHits) || 0,
      misses: parseInt(cacheMisses) || 0,
      hitRate: cacheHitRate.toFixed(2),
    },
  };
}

/**
 * Get popular searches
 */
async function getPopularSearches(limit = 10) {
  const results = await getTopFromSortedSet(keys.popularSearches(), limit);
  return results.map((item) => ({
    query: item.value,
    score: item.score,
  }));
}

/**
 * Get popular movies
 */
async function getPopularMovies(limit = 10) {
  const results = await getTopFromSortedSet(keys.popularMovies(), limit);
  return results.map((item) => {
    try {
      return { ...JSON.parse(item.value), views: item.score };
    } catch {
      return { data: item.value, views: item.score };
    }
  });
}

/**
 * Get popular TV shows
 */
async function getPopularTVShows(limit = 10) {
  const results = await getTopFromSortedSet(keys.popularTVShows(), limit);
  return results.map((item) => {
    try {
      return { ...JSON.parse(item.value), views: item.score };
    } catch {
      return { data: item.value, views: item.score };
    }
  });
}

/**
 * Get active users count for today
 */
async function getActiveUsersCount() {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${keys.activeUsers()}:${today}`;
  
  const { getRedisClient, isRedisReady } = require('../../config/redis');
  if (!isRedisReady()) {
    return 0;
  }

  try {
    const redis = getRedisClient();
    return await redis.sCard(key);
  } catch (error) {
    logger.error('Failed to get active users count', { error: error.message });
    return 0;
  }
}

/**
 * Get performance metrics by endpoint
 */
async function getPerformanceMetrics() {
  const [requestsByEndpoint, responseTimesByEndpoint, errorsByEndpoint] = await Promise.all([
    getHash(keys.requestsByEndpoint()),
    getHash(keys.responseTimesByEndpoint()),
    getHash(keys.errorsByEndpoint()),
  ]);

  const endpointMetrics = {};

  Object.keys(requestsByEndpoint).forEach((endpoint) => {
    const requests = parseInt(requestsByEndpoint[endpoint]) || 0;
    const totalTime = parseInt(responseTimesByEndpoint[endpoint]) || 0;
    const errors = parseInt(errorsByEndpoint[endpoint]) || 0;

    endpointMetrics[endpoint] = {
      requests,
      averageResponseTime: requests > 0 ? (totalTime / requests).toFixed(2) : 0,
      errors,
      errorRate: requests > 0 ? ((errors / requests) * 100).toFixed(2) : 0,
    };
  });

  return endpointMetrics;
}

module.exports = {
  trackRequest,
  trackError,
  trackActiveUser,
  trackSearch,
  trackMovieView,
  trackTVView,
  trackCacheHit,
  trackCacheMiss,
  getOverviewMetrics,
  getPopularSearches,
  getPopularMovies,
  getPopularTVShows,
  getActiveUsersCount,
  getPerformanceMetrics,
};
