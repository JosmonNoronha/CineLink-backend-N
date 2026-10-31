// src/routes/index.js — updated, add the one new line marked NEW
'use strict';

const { Router } = require('express');

const health          = require('./health');
const status          = require('./status');
const metrics         = require('./metrics');
const analytics       = require('./analytics');
const movies          = require('./movies');
const tv              = require('./tv');
const search          = require('./search');
const trending        = require('./trending');
const recommendations = require('./recommendations');

const router = Router();

router.use('/health',          health);
router.use('/status',          status);
router.use('/metrics',         metrics.router);
router.use('/analytics',       analytics);
router.use('/admin/moderation', require('./moderation'));
router.use('/admin/links',      require('./adminLinks'));
router.use('/admin/streaming', require('./streaming').adminRouter);
router.use('/streaming',       require('./streaming').publicRouter);
router.use('/movies',          movies);
router.use('/tv',              tv);
router.use('/search',          search);
router.use('/trending/trailers', require('./trailers'));
router.use('/trending',        trending);
router.use('/recommendations', recommendations);

// ── NEW ──────────────────────────────────────────────────────────────────────
router.use('/public-watchlists', (req, res, next) => {
  const publicWatchlists = require('./publicWatchlists');
  return publicWatchlists(req, res, next);
});
// ─────────────────────────────────────────────────────────────────────────────

router.use('/user', (req, res, next) => {
  const user = require('./user');
  return user(req, res, next);
});

module.exports = router;