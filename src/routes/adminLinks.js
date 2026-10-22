'use strict';

const { Router } = require('express');
const { ok } = require('../utils/helpers');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { env } = require('../config/environment');
const { buildAdminLinks } = require('../services/adminLinks');

const router = Router();

// Infrastructure addresses: admins only.
router.get('/', authMiddleware, requirePermission('admin:all'), (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return ok(res, buildAdminLinks(env));
});

module.exports = router;
