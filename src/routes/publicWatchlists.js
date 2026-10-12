// src/routes/publicWatchlists.js
'use strict';

const { Router } = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { ok } = require('../utils/helpers');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { AppError } = require('../utils/errors');
const svc = require('../services/publicWatchlists');

const router = Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────

const byUser = (req) => req?.user?.uid || req.ip;

const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUser,
});

const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUser,
});

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUser,
});

const requireModerator = (req, _res, next) => {
  if (!req.user?.permissions?.includes('content:moderate')) {
    return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
  }
  return next();
};

// ─── Validation schemas ───────────────────────────────────────────────────────

const tagsSchema = Joi.array().items(Joi.string().trim().max(30)).max(10);

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().max(500).allow('').optional(),
  tags: tagsSchema.optional(),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  description: Joi.string().trim().max(500).allow('').optional(),
  tags: tagsSchema.optional(),
}).min(1);

// Title/poster/year are resolved server-side from TMDB; any client metadata is dropped.
const addItemSchema = Joi.object({
  tmdb_id: Joi.number().integer().min(1).required(),
  media_type: Joi.string().valid('movie', 'tv').required(),
  metadata: Joi.any().strip(),
});

const listIdSchema = Joi.object({ id: Joi.string().trim().min(1).max(128).required() });

const itemKeySchema = Joi.object({
  id: Joi.string().trim().min(1).max(128).required(),
  tmdbKey: Joi.string().pattern(/^(movie|tv):\d+$/).required(),
});

const discoverQuerySchema = Joi.object({
  sort: Joi.string().valid('popular', 'recent').default('popular'),
  tag: Joi.string().trim().max(30).optional(),
  limit: Joi.number().integer().min(1).max(50).default(20),
  cursor: Joi.string().max(512).optional(),
});

const paginationSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).default(20),
  cursor: Joi.string().max(512).optional(),
});

const membershipQuerySchema = Joi.object({
  key: Joi.string().pattern(/^(movie|tv):\d+$/).required(),
});

const reportSchema = Joi.object({
  reason: Joi.string().valid(...svc.REPORT_REASONS).required(),
  note: Joi.string().trim().max(300).allow('').optional(),
});

// ─── Routes (static paths before /:id) ────────────────────────────────────────

router.get('/', optionalAuth, validate({ query: discoverQuerySchema }), async (req, res) => {
  const data = await svc.discoverPublicWatchlists({
    sort: req.query.sort,
    tag: req.query.tag || null,
    limit: req.query.limit,
    cursor: req.query.cursor || null,
    requestingUid: req.user?.uid || null,
  });
  return ok(res, data);
});

router.post('/', authMiddleware, writeLimiter, validate({ body: createSchema }), async (req, res) => {
  // Display name only — never fall back to the email address.
  const data = await svc.createPublicWatchlist(req.user.uid, {
    ...req.body,
    ownerName: req.user.name || '',
  });
  return ok(res, data);
});

router.get('/me', authMiddleware, validate({ query: paginationSchema }), async (req, res) => {
  const data = await svc.getUserPublicWatchlists(req.user.uid, {
    limit: req.query.limit,
    cursor: req.query.cursor || null,
  });
  return ok(res, data);
});

router.get('/followed', authMiddleware, validate({ query: paginationSchema }), async (req, res) => {
  const data = await svc.getFollowedWatchlists(req.user.uid, {
    limit: req.query.limit,
    cursor: req.query.cursor || null,
  });
  return ok(res, data);
});

// Which of the caller's own public lists already contain this title (movie:123 / tv:456).
router.get('/membership', authMiddleware, validate({ query: membershipQuerySchema }), async (req, res) =>
  ok(res, await svc.getMembership(req.user.uid, req.query.key)),
);

router.get('/:id', optionalAuth, validate({ params: listIdSchema }), async (req, res) => {
  return ok(res, await svc.getPublicWatchlist(req.params.id, req.user?.uid || null));
});

router.patch(
  '/:id',
  authMiddleware,
  writeLimiter,
  validate({ params: listIdSchema, body: updateSchema }),
  async (req, res) => ok(res, await svc.updatePublicWatchlist(req.user.uid, req.params.id, req.body)),
);

router.delete('/:id', authMiddleware, writeLimiter, validate({ params: listIdSchema }), async (req, res) =>
  ok(res, await svc.deletePublicWatchlist(req.user.uid, req.params.id)),
);

router.get(
  '/:id/items',
  optionalAuth,
  validate({ params: listIdSchema, query: paginationSchema }),
  async (req, res) =>
    ok(res, await svc.getPublicWatchlistItems(req.params.id, {
      limit: req.query.limit,
      cursor: req.query.cursor || null,
    })),
);

router.post(
  '/:id/items',
  authMiddleware,
  writeLimiter,
  validate({ params: listIdSchema, body: addItemSchema }),
  async (req, res) => ok(res, await svc.addItemToPublicWatchlist(req.user.uid, req.params.id, req.body)),
);

// tmdbKey format: movie:12345 or tv:67890
router.delete(
  '/:id/items/:tmdbKey',
  authMiddleware,
  writeLimiter,
  validate({ params: itemKeySchema }),
  async (req, res) =>
    ok(res, await svc.removeItemFromPublicWatchlist(req.user.uid, req.params.id, req.params.tmdbKey)),
);

router.post('/:id/like', authMiddleware, socialLimiter, validate({ params: listIdSchema }), async (req, res) =>
  ok(res, await svc.toggleLike(req.user.uid, req.params.id)),
);

// Follow state and the user's followed index are written in one transaction in the service.
router.post('/:id/follow', authMiddleware, socialLimiter, validate({ params: listIdSchema }), async (req, res) =>
  ok(res, await svc.toggleFollow(req.user.uid, req.params.id)),
);

router.post(
  '/:id/report',
  authMiddleware,
  reportLimiter,
  validate({ params: listIdSchema, body: reportSchema }),
  async (req, res) => ok(res, await svc.reportPublicWatchlist(req.user.uid, req.params.id, req.body)),
);

// Moderators only: hides the list from all public reads.
router.post(
  '/:id/takedown',
  authMiddleware,
  requireModerator,
  validate({ params: listIdSchema }),
  async (req, res) => ok(res, await svc.takedownPublicWatchlist(req.params.id, req.user.uid)),
);

module.exports = router;