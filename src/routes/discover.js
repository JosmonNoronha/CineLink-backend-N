const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const { authMiddleware } = require('../middleware/auth');
const { batchDetailsLimiter } = require('../middleware/rateLimiter');
const discover = require('../services/tmdb/discover');
const { getUpcomingTimeline } = require('../services/tmdb/upcomingTimeline');

const router = Router();

const month = Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required();

// GET /discover/calendar?month=2026-12&type=movie&region=IN
// (declared before '/:feed' so "calendar" is not read as a feed name)
router.get(
  '/calendar',
  validate({
    query: Joi.object({
      month,
      type: Joi.string().valid('movie', 'tv').default('movie'),
      region: Joi.string().trim().uppercase().pattern(/^[A-Z]{2}$/).default('US'),
    }),
  }),
  async (req, res) => {
    const data = await discover.getCalendar(req.query);
    res.set('Cache-Control', 'public, max-age=300');
    return ok(res, data);
  }
);

// POST /discover/calendar/my-shows  { month, ids: [tmdb tv ids] }
// Each id can cost a TMDB call, so it needs a signed-in user like batch-details does.
router.post(
  '/calendar/my-shows',
  authMiddleware,
  batchDetailsLimiter,
  validate({
    body: Joi.object({
      month,
      ids: Joi.array().items(Joi.number().integer().min(1)).max(discover.MAX_MY_SHOWS).default([]),
    }),
  }),
  async (req, res) => ok(res, await discover.getMyShowsCalendar(req.body))
);

// GET /discover/upcoming/timeline?region=IN   (movies + series, one list sorted by date)
router.get(
  '/upcoming/timeline',
  validate({
    query: Joi.object({
      region: Joi.string().trim().uppercase().pattern(/^[A-Z]{2}$/).default('US'),
    }),
  }),
  async (req, res) => {
    const data = await getUpcomingTimeline({ region: req.query.region });
    res.set('Cache-Control', 'public, max-age=300');
    return ok(res, data);
  }
);

// GET /discover/in-theaters?region=IN&type=movie&page=1
router.get(
  '/:feed',
  validate({
    params: Joi.object({ feed: Joi.string().valid(...discover.FEED_IDS).required() }),
    query: Joi.object({
      type: Joi.string().valid('movie', 'tv').default('movie'),
      region: Joi.string().trim().uppercase().pattern(/^[A-Z]{2}$/).default('US'),
      page: Joi.number().integer().min(1).max(discover.MAX_PAGES).default(1),
    }),
  }),
  async (req, res) => {
    const data = await discover.getFeed({
      feed: req.params.feed,
      type: req.query.type,
      region: req.query.region,
      page: req.query.page,
    });
    res.set('Cache-Control', 'public, max-age=300');
    return ok(res, data);
  }
);

module.exports = router;
