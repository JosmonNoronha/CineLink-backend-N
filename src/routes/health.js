const { Router } = require('express');
const { ok } = require('../utils/helpers');
const { isRedisReady } = require('../config/redis');
const pkg = require('../../package.json');

const router = Router();

router.get('/', async (_req, res) => {
  return ok(res, {
    status: 'healthy',
    version: pkg.version,
    timestamp: new Date().toISOString(),
    services: {
      cache: isRedisReady() ? 'healthy' : 'disabled-or-not-ready',
    },
  });
});

router.get('/deep', async (_req, res) => {
  // Lazy-load these heavier deps so basic health checks stay fast.
  const { getFirestore } = require('../config/firebase');
  const { tmdbGet } = require('../services/tmdb/client');

  const services = {
    cache: isRedisReady() ? 'healthy' : 'disabled-or-not-ready',
    firestore: 'unknown',
    tmdb: 'unknown',
  };

  try {
    await getFirestore().collection('_health').doc('ping').get();
    services.firestore = 'healthy';
  } catch (_e) {
    services.firestore = 'unhealthy';
  }

  try {
    await tmdbGet('/configuration');
    services.tmdb = 'healthy';
  } catch (_e) {
    services.tmdb = 'unhealthy';
  }

  return ok(res, {
    status: Object.values(services).includes('unhealthy') ? 'degraded' : 'healthy',
    version: pkg.version,
    timestamp: new Date().toISOString(),
    services,
  });
});

module.exports = router;
