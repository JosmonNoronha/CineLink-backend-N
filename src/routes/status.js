const { Router } = require('express');
const { ok } = require('../utils/helpers');
const { env } = require('../config/environment');

const router = Router();

router.get('/', (_req, res) => {
  return ok(res, {
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
