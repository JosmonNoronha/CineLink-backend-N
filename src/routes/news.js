'use strict';

const { Router } = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { ok } = require('../utils/helpers');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validator');
const { CATEGORIES } = require('../services/news/parse');

const ipLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.uid, // runs after authMiddleware
});

const listQuery = Joi.object({
  sort: Joi.string().valid('latest', 'trending', 'today', 'week'),
  category: Joi.string().valid('all', ...CATEGORIES),
  region: Joi.string().valid('all', 'global', 'in'),
  limit: Joi.number().integer().min(1).max(50),
  before: Joi.string().pattern(/^(\d{10,14}\.[0-9a-f]{16}|o\d{1,4})$/),
});
const idParams = Joi.object({ id: Joi.string().pattern(/^[0-9a-f]{16}$/).required() });
const sourceParams = Joi.object({ id: Joi.string().pattern(/^[a-z0-9-]{1,40}$/).required() });

function createNewsRouters(deps = {}) {
  let cached;
  const build = () => {
    if (cached) return cached;
    if (deps.service) {
      cached = { service: deps.service };
      return cached;
    }
    const { getFirestore } = require('../config/firebase');
    const { createNewsStore } = require('../services/news/store');
    const { createNewsService } = require('../services/news/service');
    cached = { service: createNewsService({ store: deps.store || createNewsStore(getFirestore()) }) };
    return cached;
  };

  const publicRouter = Router();
  publicRouter.get('/', ipLimiter, validate({ query: listQuery }), async (req, res) => {
    const data = await build().service.list({
      sort: req.query.sort,
      category: req.query.category,
      region: req.query.region,
      limit: req.query.limit ? Number(req.query.limit) : 20,
      before: req.query.before,
    });
    res.set('Cache-Control', 'public, max-age=300');
    return ok(res, data);
  });

  const adminRouter = Router();
  adminRouter.use(authMiddleware, requirePermission('admin:all'), adminLimiter);
  adminRouter.get('/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    return ok(res, await build().service.health());
  });
  adminRouter.post('/articles/:id/hide', validate({ params: idParams }), async (req, res) =>
    ok(res, await build().service.setHidden(req.params.id, true))
  );
  adminRouter.delete('/articles/:id/hide', validate({ params: idParams }), async (req, res) =>
    ok(res, await build().service.setHidden(req.params.id, false))
  );
  adminRouter.post('/sources/:id/disable', validate({ params: sourceParams }), async (req, res) =>
    ok(res, await build().service.setSourceDisabled(req.params.id, true))
  );
  adminRouter.delete('/sources/:id/disable', validate({ params: sourceParams }), async (req, res) =>
    ok(res, await build().service.setSourceDisabled(req.params.id, false))
  );

  return { publicRouter, adminRouter };
}

const defaults = createNewsRouters();
module.exports = { ...defaults, createNewsRouters };
