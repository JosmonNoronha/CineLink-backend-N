const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const tvService = require('../services/tmdb/tv');
const reviewService = require('../services/tmdb/reviews');

const router = Router();

router.get(
  '/popular',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await tvService.listPopular(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/top-rated',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await tvService.listTopRated(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/airing-today',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await tvService.listAiringToday(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/on-the-air',
  validate({ query: Joi.object({ page: Joi.number().integer().min(1).default(1) }) }),
  async (req, res) => {
    const { data, source } = await tvService.listOnTheAir(req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await tvService.details(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/season/:season_number',
  validate({
    params: Joi.object({
      id: Joi.number().integer().min(1).required(),
      season_number: Joi.number().integer().min(0).required(),
    }),
  }),
  async (req, res) => {
    const { data, source } = await tvService.season(req.params.id, req.params.season_number);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/season/:season_number/episode/:episode_number',
  validate({
    params: Joi.object({
      id: Joi.number().integer().min(1).required(),
      season_number: Joi.number().integer().min(0).required(),
      episode_number: Joi.number().integer().min(1).required(),
    }),
  }),
  async (req, res) => {
    const { data, source } = await tvService.episode(
      req.params.id,
      req.params.season_number,
      req.params.episode_number
    );
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/credits',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await tvService.credits(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/videos',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await tvService.videos(req.params.id);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/season/:season_number/videos',
  validate({
    params: Joi.object({
      id: Joi.number().integer().min(1).required(),
      season_number: Joi.number().integer().min(0).required(),
    }),
  }),
  async (req, res) => {
    const { data, source } = await tvService.seasonVideos(req.params.id, req.params.season_number);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/images',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await tvService.images(req.params.id);
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
    const { data, source } = await tvService.recommendations(req.params.id, req.query.page);
    return ok(res, data, { source });
  }
);

router.get(
  '/:id/watch-providers',
  validate({ params: Joi.object({ id: Joi.number().integer().min(1).required() }) }),
  async (req, res) => {
    const { data, source } = await tvService.watchProviders(req.params.id);
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
    const { data, source } = await reviewService.getTVReviews(req.params.id, req.query.page);
    return ok(res, data, { source });
  }
);

module.exports = router;
