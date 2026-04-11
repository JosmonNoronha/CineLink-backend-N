const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const { searchLimiter } = require('../middleware/rateLimiter');
const searchService = require('../services/tmdb/search');
const { searchPeople, searchByGenreOmdbLike } = require('../services/tmdb/compat');
const { searchByGenre } = require('../services/tmdb/genres');
const { unifiedSearch } = require('../services/search/unified');
const { analyticsService } = require('../services/analytics');
const trendingService = require('../services/tmdb/trending');

const router = Router();

const searchQuerySchema = Joi.object({
  query: Joi.string().trim().min(1).max(200).required(),
  page: Joi.number().integer().min(1).default(1),
});

const unifiedSearchSchema = Joi.object({
  query: Joi.string().trim().min(1).max(200).required(),
  type: Joi.string().valid('movie', 'series', 'episode', 'all').default('all'),
  page: Joi.number().integer().min(1).default(1),
  filters: Joi.object().unknown(true).default({}),
  cursor: Joi.string().allow('').optional(),
});

const suggestionQuerySchema = Joi.object({
  query: Joi.string().trim().allow('').default(''),
  limit: Joi.number().integer().min(1).max(20).default(8),
});

router.use(searchLimiter);

router.post('/', validate({ body: unifiedSearchSchema }), async (req, res) => {
  await req.analytics.trackSearch(req.body.query);

  const data = await unifiedSearch({
    query: req.body.query,
    type: req.body.type,
    page: req.body.page,
    filters: req.body.filters,
    cursor: req.body.cursor,
  });

  return ok(res, data);
});

router.get('/suggestions', validate({ query: suggestionQuerySchema }), async (req, res) => {
  const query = (req.query.query || '').trim().toLowerCase();
  const limit = req.query.limit || 8;

  const [popularSearches, trendingKeywords] = await Promise.all([
    analyticsService.getPopularSearches(30),
    trendingService.getTrendingSearchKeywords(),
  ]);

  const analyticsKeywords = (popularSearches || [])
    .map((item) => item?.query)
    .filter(Boolean);

  const merged = [...analyticsKeywords, ...(trendingKeywords || [])];
  const filtered = query
    ? merged.filter((item) => item.toLowerCase().includes(query))
    : merged;

  const deduped = filtered.filter((item, index, arr) => arr.indexOf(item) === index);
  const suggestions = deduped.slice(0, limit);

  return ok(res, {
    suggestions,
    source: analyticsKeywords.length > 0 ? 'analytics+trending' : 'trending',
  });
});

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
