// src/routes/moderation.js
'use strict';

const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validator');
const svc = require('../services/moderation');

const router = Router();

// Everything here needs a signed-in moderator (or admin). Roles come from Firebase custom claims.
router.use(authMiddleware, requirePermission('content:moderate'));

const idParams = Joi.object({ id: Joi.string().trim().min(1).max(128).required() });
const limitQuery = (max, def) => Joi.object({ limit: Joi.number().integer().min(1).max(max).default(def) });

const takedownBody = Joi.object({
  reason: Joi.string().valid(...svc.REPORT_REASONS).required(),
  note: Joi.string().trim().max(500).allow('').default(''),
});
const noteBody = Joi.object({ note: Joi.string().trim().max(500).allow('').default('') });

// Reported lists, most-reported first.
router.get('/queue', validate({ query: limitQuery(100, 50) }), async (req, res) =>
  ok(res, await svc.listQueue({ limit: req.query.limit })),
);

// One list: its content, every report, and its moderation history.
router.get('/lists/:id', validate({ params: idParams }), async (req, res) =>
  ok(res, await svc.getReportDetail(req.params.id)),
);

router.post('/lists/:id/takedown', validate({ params: idParams, body: takedownBody }), async (req, res) =>
  ok(res, await svc.applyDecision(req.params.id, req.user.uid, { decision: 'takedown', ...req.body })),
);

router.post('/lists/:id/restore', validate({ params: idParams, body: noteBody }), async (req, res) =>
  ok(res, await svc.applyDecision(req.params.id, req.user.uid, { decision: 'restore', ...req.body })),
);

router.post('/lists/:id/dismiss', validate({ params: idParams, body: noteBody }), async (req, res) =>
  ok(res, await svc.applyDecision(req.params.id, req.user.uid, { decision: 'dismiss', ...req.body })),
);

// Global audit trail: admins only.
router.get('/audit', requirePermission('admin:all'), validate({ query: limitQuery(200, 50) }), async (req, res) =>
  ok(res, await svc.getAuditLog({ limit: req.query.limit })),
);

module.exports = router;
