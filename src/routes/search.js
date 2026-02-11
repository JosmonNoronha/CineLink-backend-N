const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const { searchLimiter } = require('../middleware/rateLimiter');
const searchService = require('../services/tmdb/search');
const { searchPeople, searchByGenreOmdbLike } = require('../services/tmdb/compat');
const { searchByGenre } = require('../services/tmdb/genres');

const router = Router();

const searchQuerySchema = Joi.object({
  query: Joi.string().trim().min(1).max(200).required(),
  page: Joi.number().integer().min(1).default(1),
});

router.use(searchLimiter);

router.get('/multi', validate({ query: searchQuerySchema }), async (req, res) => {
  // Track search query
  await req.analytics.trackSearch(req.query.query);

  const { data, source } = await searchService.multi(req.query.query, req.query.page);
  return ok(res, data, { source });
});

router.get('/movie', validate({ query: searchQuerySchema }), async (req, res) => {
  // Track search query
  await req.analytics.trackSearch(req.query.query);

  const { data, source } = await searchService.movie(req.query.query, req.query.page);
  return ok(res, data, { source });
});

router.get('/tv', validate({ query: searchQuerySchema }), async (req, res) => {
  // Track search query
  await req.analytics.trackSearch(req.query.query);

  const { data, source } = await searchService.tv(req.query.query, req.query.page);
  return ok(res, data, { source });
});

router.get('/person', validate({ query: searchQuerySchema }), async (req, res) => {
  const { data, source } = await searchService.person(req.query.query, req.query.page);
  return ok(res, data, { source });
});

// New endpoint: Search by person name and return their movies
router.get('/by-person', validate({ query: searchQuerySchema }), async (req, res) => {
  const results = await searchPeople({ q: req.query.query, page: req.query.page });
  return ok(res, results);
});

// New endpoint: Search by genre/keyword (action, anime, thriller, etc.)
const genreSearchSchema = Joi.object({
  genre: Joi.string().trim().min(1).max(50).required(),
  type: Joi.string().valid('movie', 'series').optional(),
  page: Joi.number().integer().min(1).default(1),
});

router.get('/by-genre', validate({ query: genreSearchSchema }), async (req, res) => {
  const genreResults = await searchByGenre({
    genre: req.query.genre,
    type: req.query.type,
    page: req.query.page,
  });
  const formatted = await searchByGenreOmdbLike({ genreResults });
  return ok(res, formatted);
});

module.exports = router;
