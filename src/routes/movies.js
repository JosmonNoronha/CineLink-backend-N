const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const movieService = require('../services/tmdb/movies');
const reviewService = require('../services/tmdb/reviews');
const compat = require('../services/tmdb/compat');

const router = Router();

// -------- Legacy endpoints (OMDb-like) used by current mobile app --------
router.get(
  '/search',
  validate({
    query: Joi.object({
      q: Joi.string().trim().min(1).max(200).required(),
      type: Joi.string().valid('movie', 'series', 'episode', 'all').optional(),
      page: Joi.number().integer().min(1).default(1),
    }),
  }),
  async (req, res, next) => {
    try {
      // Track search query
      await req.analytics.trackSearch(req.query.q);

      const type = req.query.type && req.query.type !== 'all' ? req.query.type : undefined;
      const data = await compat.searchOmdbLike({ q: req.query.q, type, page: req.query.page });
      return ok(res, data);
    } catch (error) {
      next(error); // Let error handler middleware handle it instead of crashing
    }
  }
);

router.get(
  '/details/:id',
  validate({ params: Joi.object({ id: Joi.string().trim().min(1).max(64).required() }) }),
  async (req, res) => {
    const resolved = await compat.resolveToTmdb(req.params.id);
    if (resolved.media_type === 'movie') {
      const data = await compat.movieDetailsOmdbLike({
        tmdb_id: resolved.tmdb_id,
        imdb_id: resolved.imdb_id,
      });
      // Track movie view
      await req.analytics.trackMovieView(resolved.tmdb_id, data.Title);
      return ok(res, data);
    }
    const data = await compat.tvDetailsOmdbLike({ tmdb_id: resolved.tmdb_id, imdb_id: resolved.imdb_id });
    // Track TV view
    await req.analytics.trackTVView(resolved.tmdb_id, data.Title);
    return ok(res, data);
  }
);

router.get(
  '/season/:id/:season',
  validate({
    params: Joi.object({
      id: Joi.string().trim().min(1).max(64).required(),
      season: Joi.number().integer().min(0).required(),
    }),
  }),
  async (req, res) => {
    const resolved = await compat.resolveToTmdb(req.params.id);
    if (resolved.media_type !== 'tv') {
      return ok(res, { Season: String(req.params.season), Episodes: [], Response: 'False' });
    }
    const data = await compat.seasonOmdbLike({
      tmdb_tv_id: resolved.tmdb_id,
      season_number: req.params.season,
    });
    return ok(res, data);
  }
);

router.get(
  '/episode/:id/:season/:episode',
  validate({
    params: Joi.object({
      id: Joi.string().trim().min(1).max(64).required(),
      season: Joi.number().integer().min(0).required(),
      episode: Joi.number().integer().min(1).required(),
    }),
  }),
  async (req, res) => {
    const resolved = await compat.resolveToTmdb(req.params.id);
    if (resolved.media_type !== 'tv') {
      return ok(res, { Response: 'False' });
    }
    const data = await compat.episodeOmdbLike({
      tmdb_tv_id: resolved.tmdb_id,
      season_number: req.params.season,
      episode_number: req.params.episode,
    });
    return ok(res, data);
  }
);

router.post(
  '/batch-details',
  validate({
    body: Joi.object({ imdbIDs: Joi.array().items(Joi.string().trim().min(1)).min(1).max(50).required() }),
  }),
  async (req, res) => {
    const imdbIDs = req.body.imdbIDs;
    const results = [];
    for (const id of imdbIDs) {
      try {
        const resolved = await compat.resolveToTmdb(id);
        const data =
          resolved.media_type === 'movie'
            ? await compat.movieDetailsOmdbLike({ tmdb_id: resolved.tmdb_id, imdb_id: resolved.imdb_id })
            : await compat.tvDetailsOmdbLike({ tmdb_id: resolved.tmdb_id, imdb_id: resolved.imdb_id });
        results.push({ imdbID: id, data, error: null });
      } catch (e) {
        results.push({ imdbID: id, data: null, error: e.message || 'Failed' });
      }
    }
    return ok(res, { results });
  }
);

router.get(
  '/popular',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await movieService.listPopular(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/top-rated',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await movieService.listTopRated(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/now-playing',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await movieService.listNowPlaying(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/upcoming',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await movieService.listUpcoming(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await movieService.details(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/credits',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await movieService.credits(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/videos',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await movieService.videos(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/images',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await movieService.images(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/recommendations',
  validate({
    params: Joi.object({ id: Joi.number().integer().min(1).required() }),
    query: Joi.object({ page: Joi.number().integer().min(1).default(1) }),
  }),
  async (req, res) => {
    const { data, source } = await movieService.recommendations(req.params.id, req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/watch-providers',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await movieService.watchProviders(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/reviews',
  validate({
    params: Joi.object({ id: Joi.number().integer().min(1).required() }),
    query: Joi.object({ page: Joi.number().integer().min(1).default(1) }),
  }),
  async (req, res) => {
    const { data, source } = await reviewService.getMovieReviews(req.params.id, req.query.page);
    return ok(res, data, { source });
  }
);

module.exports = router;
