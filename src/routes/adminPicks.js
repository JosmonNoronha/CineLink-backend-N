'use strict';

const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { tmdbGet } = require('../services/tmdb/client');
const picks = require('../services/discoverPicks');

const router = Router();
// Author's choice is edited by admins only.
router.use(authMiddleware, requirePermission('admin:all'));
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const idParams = Joi.object({ id: Joi.string().pattern(/^(movie|tv)-\d+$/).required() });
const note = Joi.string().trim().allow('').max(picks.NOTE_MAX);

router.get('/', async (_req, res) => ok(res, { items: await picks.list(), max: picks.MAX_PICKS }));

// Find a title on TMDB to add
router.get(
  '/search',
  validate({
    query: Joi.object({
      q: Joi.string().trim().min(1).max(100).required(),
      type: Joi.string().valid('movie', 'tv').default('movie'),
    }),
  }),
  async (req, res) => {
    const raw = await tmdbGet(`/search/${req.query.type}`, { query: req.query.q, language: 'en-US', include_adult: false, page: 1 });
    const results = (raw.results || []).slice(0, 12).map((r) => ({
      tmdbId: r.id,
      type: req.query.type,
      title: r.title || r.name,
      year: String(r.release_date || r.first_air_date || '').slice(0, 4) || null,
      posterPath: r.poster_path || null,
    }));
    return ok(res, { results });
  }
);

router.post(
  '/',
  validate({
    body: Joi.object({
      type: Joi.string().valid('movie', 'tv').required(),
      tmdbId: Joi.number().integer().min(1).required(),
      title: Joi.string().trim().min(1).max(200).required(),
      posterPath: Joi.string().allow('', null),
      year: Joi.string().allow('', null).max(4),
      note,
    }),
  }),
  async (req, res) => ok(res, await picks.add({ ...req.body, by: req.user?.uid }))
);

router.patch(
  '/:id',
  validate({ params: idParams, body: Joi.object({ note: note.required() }) }),
  async (req, res) => ok(res, await picks.setNote(req.params.id, req.body.note))
);

router.post(
  '/reorder',
  validate({ body: Joi.object({ ids: Joi.array().items(Joi.string().pattern(/^(movie|tv)-\d+$/)).min(1).max(picks.MAX_PICKS).required() }) }),
  async (req, res) => ok(res, await picks.reorder(req.body.ids))
);

router.delete('/:id', validate({ params: idParams }), async (req, res) => ok(res, await picks.remove(req.params.id)));

module.exports = router;
