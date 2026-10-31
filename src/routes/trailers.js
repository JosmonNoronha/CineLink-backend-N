const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const trailers = require('../services/tmdb/trailers');

const router = Router();

// GET /trending/trailers?limit=12  ->  { trailers: [...] }  (newest trailer first)
router.get(
  '/',
  validate({ query: Joi.object({ limit: Joi.number().integer().min(1).max(20).default(12) }) }),
  async (req, res) => {
    const { data, source } = await trailers.latestTrailers({ limit: req.query.limit });
    res.set('Cache-Control', 'public, max-age=600');
    return ok(res, { trailers: data }, { source });
  }
);

module.exports = router;
