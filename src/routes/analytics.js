const { Router } = require('express');
const { analyticsService } = require('../services/analytics');
const { ok } = require('../utils/helpers');
const { optionalAuth } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errors');

const router = Router();

/**
 * GET /api/analytics/overview
 * Get overall analytics overview
 */
router.get('/overview', optionalAuth, async (req, res) => {
  try {
    const overview = await analyticsService.getOverview();
    const userEngagement = await analyticsService.getUserEngagement();
    
    return ok(res, {
      ...overview,
      engagement: userEngagement,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get analytics overview', { error: error.message });
    throw new AppError(
      'Failed to retrieve analytics overview',
      500,
      'ANALYTICS_ERROR',
      { serviceError: error.message },
      {
        userMessage: 'Unable to load analytics overview right now. Please try again.',
        retryable: true,
      }
    );
  }
});

/**
 * GET /api/analytics/popular-searches
 * Get most popular search queries
 */
router.get('/popular-searches', optionalAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const searches = await analyticsService.getPopularSearches(limit);
    
    return ok(res, {
      searches,
      count: searches.length,
    });
  } catch (error) {
    logger.error('Failed to get popular searches', { error: error.message });
    throw new AppError(
      'Failed to retrieve popular searches',
      500,
      'ANALYTICS_ERROR',
      { serviceError: error.message },
      {
        userMessage: 'Unable to load popular searches right now. Please try again.',
        retryable: true,
      }
    );
  }
});

/**
 * GET /api/analytics/popular-content
 * Get most viewed movies and TV shows
 */
router.get('/popular-content', optionalAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const content = await analyticsService.getPopularContent(limit);
    
    return ok(res, content);
  } catch (error) {
    logger.error('Failed to get popular content', { error: error.message });
    throw new AppError(
      'Failed to retrieve popular content',
      500,
      'ANALYTICS_ERROR',
      { serviceError: error.message },
      {
        userMessage: 'Unable to load popular content right now. Please try again.',
        retryable: true,
      }
    );
  }
});

/**
 * GET /api/analytics/user-engagement
 * Get user engagement metrics
 */
router.get('/user-engagement', optionalAuth, async (req, res) => {
  try {
    const engagement = await analyticsService.getUserEngagement();
    
    return ok(res, engagement);
  } catch (error) {
    logger.error('Failed to get user engagement', { error: error.message });
    throw new AppError(
      'Failed to retrieve user engagement',
      500,
      'ANALYTICS_ERROR',
      { serviceError: error.message },
      {
        userMessage: 'Unable to load user engagement right now. Please try again.',
        retryable: true,
      }
    );
  }
});

/**
 * GET /api/analytics/performance
 * Get API performance metrics
 */
router.get('/performance', optionalAuth, async (req, res) => {
  try {
    const performance = await analyticsService.getPerformanceMetrics();
    
    return ok(res, {
      endpoints: performance,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get performance metrics', { error: error.message });
    throw new AppError(
      'Failed to retrieve performance metrics',
      500,
      'ANALYTICS_ERROR',
      { serviceError: error.message },
      {
        userMessage: 'Unable to load performance metrics right now. Please try again.',
        retryable: true,
      }
    );
  }
});

module.exports = router;
