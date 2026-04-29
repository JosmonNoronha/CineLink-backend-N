const responseTime = require('response-time');
const { metrics } = require('../services/analytics');
const { logger } = require('../utils/logger');
const { isRedisReady } = require('../config/redis');
const { httpRequestDuration, httpRequestTotal } = require('../routes/metrics');

/**
 * Middleware to track API performance metrics
 * Only tracks if Redis is available to avoid performance impact
 */
function createMetricsMiddleware() {
  return responseTime(async (req, res, time) => {
    const routeLabel = `${req.baseUrl || ''}${req.route?.path || req.path}`;
    const durationSeconds = Number(time) / 1000;
    const statusCode = String(res.statusCode);

    try {
      httpRequestDuration.observe(
        {
          method: req.method,
          route: routeLabel,
          status_code: statusCode,
        },
        durationSeconds
      );
      httpRequestTotal.inc({
        method: req.method,
        route: routeLabel,
        status_code: statusCode,
      });
    } catch (error) {
      logger.debug('Prometheus metrics tracking failed', { error: error.message });
    }

    // Skip analytics if Redis is not ready to avoid Firestore overhead
    if (!isRedisReady()) {
      return;
    }

    try {
      const endpoint = req.route?.path || req.path;
      const method = req.method;
      const numericStatusCode = res.statusCode;
      const userId = req.user?.uid || null;

      // Track the request
      await metrics.trackRequest(endpoint, method, numericStatusCode, Math.round(time), userId);

      // Track errors
      if (numericStatusCode >= 400) {
        await metrics.trackError(endpoint, method, { statusCode: numericStatusCode });
      }
    } catch (error) {
      // Silent fail - don't let analytics break the app
      logger.debug('Metrics tracking failed', { error: error.message });
    }
  });
}

/**
 * Middleware to track specific analytics events
 * Only tracks if Redis is available
 */
function analyticsMiddleware(req, res, next) {
  // Add analytics helper to request object
  req.analytics = {
    trackSearch: async (query) => {
      if (!isRedisReady()) return;
      try {
        const userId = req.user?.uid || null;
        await metrics.trackSearch(query, userId);
      } catch (error) {
        logger.debug('Failed to track search', { error: error.message });
      }
    },
    trackMovieView: async (movieId, title) => {
      if (!isRedisReady()) return;
      try {
        const userId = req.user?.uid || null;
        await metrics.trackMovieView(movieId, title, userId);
      } catch (error) {
        logger.debug('Failed to track movie view', { error: error.message });
      }
    },
    trackTVView: async (tvId, title) => {
      if (!isRedisReady()) return;
      try {
        const userId = req.user?.uid || null;
        await metrics.trackTVView(tvId, title, userId);
      } catch (error) {
        logger.debug('Failed to track TV view', { error: error.message });
      }
    },
  };

  next();
}

module.exports = {
  createMetricsMiddleware,
  analyticsMiddleware,
};
