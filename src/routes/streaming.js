'use strict';

const { Router } = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { ok } = require('../utils/helpers');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validator');
const { AppError } = require('../utils/errors');

const ipLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req?.user?.uid || req.ip,
});

const params = Joi.object({
  tmdbId: Joi.number().integer().positive().required(),
  n: Joi.number().integer().min(1).max(100000),
});
const regionQuery = Joi.object({
  region: Joi.string()
    .length(2)
    .pattern(/^[A-Za-z]{2}$/)
    .optional(),
});

/**
 * Dependencies are injected so tests need no Firebase or YouTube; the defaults are the real ones.
 */
function createStreamingRouters(deps = {}) {
  let cached;
  const build = () => {
    if (cached) return cached;
    const { getFirestore } = require('../config/firebase');
    const { env } = require('../config/environment');
    const { createCatalog } = require('../services/streaming/catalog');
    const { createStreamingService } = require('../services/streaming/service');
    const { createYouTube } = require('../services/streaming/youtube');
    const catalog = deps.catalog || createCatalog(getFirestore());
    cached = {
      catalog,
      service: deps.service || createStreamingService({ catalog }),
      youtube: () => (deps.youtube ? deps.youtube() : createYouTube({ apiKey: env.YOUTUBE_API_KEY })),
    };
    return cached;
  };

  // ── Public: what can I watch? ────────────────────────────────────────────────
  const publicRouter = Router();

  publicRouter.get('/shows', ipLimiter, validate({ query: regionQuery }), async (req, res) => {
    const shows = await build().service.listShows(req.query.region);
    res.set('Cache-Control', 'public, max-age=300');
    return ok(res, { shows });
  });

  publicRouter.get(
    '/shows/:tmdbId',
    ipLimiter,
    validate({ params, query: regionQuery }),
    async (req, res) => {
      const data = await build().service.availability(req.params.tmdbId, req.query.region);
      res.set('Cache-Control', 'public, max-age=300');
      return ok(res, data);
    }
  );

  publicRouter.get(
    '/shows/:tmdbId/episodes/:n',
    ipLimiter,
    validate({ params, query: regionQuery }),
    async (req, res) => {
      const data = await build().service.episode(req.params.tmdbId, req.params.n, req.query.region);
      res.set('Cache-Control', 'public, max-age=300');
      return ok(res, data);
    }
  );

  // ── Admin ────────────────────────────────────────────────────────────────────
  const adminRouter = Router();
  adminRouter.use(authMiddleware, requirePermission('admin:all'), adminLimiter);

  let syncing = false;
  adminRouter.post(
    '/shows/:tmdbId/sync',
    validate({
      params,
      body: Joi.object({ mode: Joi.string().valid('recent', 'verify').default('recent') }),
    }),
    async (req, res) => {
      const { getShow } = require('../services/streaming/shows');
      const { syncShow } = require('../services/streaming/sync');
      const show = getShow(req.params.tmdbId);
      if (!show) throw new AppError('Unknown show', 404, 'STREAMING_NOT_FOUND');
      if (syncing) throw new AppError('A sync is already running', 409, 'SYNC_RUNNING');
      syncing = true;
      try {
        const b = build();
        const report = await syncShow({
          show,
          mode: req.body.mode,
          youtube: b.youtube(),
          catalog: b.catalog,
        });
        b.service.invalidate(show.tmdbId);
        return ok(res, report);
      } finally {
        syncing = false;
      }
    }
  );

  adminRouter.get(
    '/shows/:tmdbId/report',
    validate({ params, query: Joi.object({ total: Joi.number().integer().min(1).max(100000) }) }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      return ok(res, await build().service.report(req.params.tmdbId, req.query.total));
    }
  );

  const videoBody = Joi.object({
    videoId: Joi.string()
      .pattern(/^[A-Za-z0-9_-]{11}$/)
      .required(),
  });
  adminRouter.post('/shows/:tmdbId/block', validate({ params, body: videoBody }), async (req, res) =>
    ok(res, await build().service.setBlocked(req.params.tmdbId, req.body.videoId, true))
  );
  adminRouter.delete('/shows/:tmdbId/block', validate({ params, body: videoBody }), async (req, res) =>
    ok(res, await build().service.setBlocked(req.params.tmdbId, req.body.videoId, false))
  );

  return { publicRouter, adminRouter };
}

const defaults = createStreamingRouters();
module.exports = { ...defaults, createStreamingRouters };
