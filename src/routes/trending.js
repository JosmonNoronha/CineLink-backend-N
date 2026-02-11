const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const trendingService = require('../services/tmdb/trending');

const router = Router();

router.get('/search/keywords', async (req, res) => {
  const keywords = await trendingService.getTrendingSearchKeywords();
  return ok(res, { keywords });
});

router.get(
  '/:type/:time_window',
  validate({
    params: Joi.object({
      type: Joi.string().valid('all', 'movie', 'tv', 'person').required(),
      time_window: Joi.string().valid('day', 'week').required(),
    }),
  }),
  async (req, res) => {
    const { data, source } = await trendingService.trending(req.params.type, req.params.time_window);
    return ok(res, data, { source });
  }
);

module.exports = router;
