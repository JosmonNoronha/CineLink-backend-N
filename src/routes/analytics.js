const { Router } = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { analyticsService } = require('../services/analytics');
const { recordClientEvents } = require('../services/analytics/clientEvents');
const { ok } = require('../utils/helpers');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validator');
const { env } = require('../config/environment');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errors');

const router = Router();

const limitQuery = Joi.object({ limit: Joi.number().integer().min(1).max(50).default(10) });

// Operational data: only people with the admin claim. Public list further down.
const adminOnly = [authMiddleware, requirePermission('admin:all')];

function analyticsError(what, error) {
  // Details stay in the log; the client never sees internal error messages.
  logger.error(`Failed to get ${what}`, { error: error.message });
  return new AppError(`Failed to retrieve ${what}`, 500, 'ANALYTICS_ERROR', undefined, {
    userMessage: `Unable to load ${what} right now. Please try again.`,
    retryable: true,
  });
}

/** GET /api/analytics/overview  (admin) */
router.get('/overview', ...adminOnly, async (_req, res) => {
  try {
    const [overview, engagement] = await Promise.all([
      analyticsService.getOverview(),
      analyticsService.getUserEngagement(),
    ]);
    return ok(res, { ...overview, engagement, timestamp: new Date().toISOString() });
  } catch (error) {
    throw analyticsError('analytics overview', error);
  }
});

/** GET /api/analytics/user-engagement  (admin) */
router.get('/user-engagement', ...adminOnly, async (_req, res) => {
  try {
    return ok(res, await analyticsService.getUserEngagement());
  } catch (error) {
    throw analyticsError('user engagement', error);
  }
});

/** GET /api/analytics/performance  (admin) */
router.get('/performance', ...adminOnly, async (_req, res) => {
  try {
    const performance = await analyticsService.getPerformanceMetrics();
    return ok(res, { endpoints: performance, timestamp: new Date().toISOString() });
  } catch (error) {
    throw analyticsError('performance metrics', error);
  }
});

// ── Public (the app uses these for search suggestions) ────────────────────────

/**
 * GET /api/analytics/popular-searches
 * Only queries that at least POPULAR_SEARCH_MIN_COUNT searches agree on, so one person's
 * one-off search never appears. Scores are counts, not user data.
 */
router.get('/popular-searches', optionalAuth, validate({ query: limitQuery }), async (req, res) => {
  try {
    const raw = await analyticsService.getPopularSearches(req.query.limit);
    const searches = raw.filter((s) => s.score >= env.POPULAR_SEARCH_MIN_COUNT);
    res.set('Cache-Control', 'public, max-age=60');
    return ok(res, { searches, count: searches.length });
  } catch (error) {
    throw analyticsError('popular searches', error);
  }
});

/** GET /api/analytics/popular-content */
router.get('/popular-content', optionalAuth, validate({ query: limitQuery }), async (req, res) => {
  try {
    const content = await analyticsService.getPopularContent(req.query.limit);
    res.set('Cache-Control', 'public, max-age=60');
    return ok(res, content);
  } catch (error) {
    throw analyticsError('popular content', error);
  }
});

// ── Events from the app ───────────────────────────────────────────────────────

const clientEventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req?.user?.uid || req.ip,
});

/**
 * POST /api/analytics/events
 * The app reports things like "user_login". Works signed in or out. Only counted by name,
 * nothing is stored (see services/analytics/clientEvents.js). Always answers 202 so a
 * misbehaving client never sees an error for analytics.
 */
router.post('/events', optionalAuth, clientEventsLimiter, (req, res) => {
  const accepted = recordClientEvents(req.body);
  return res.status(202).json({ success: true, data: { accepted } });
});

module.exports = router;
