const { Router } = require('express');
const promClient = require('prom-client');
const { logger } = require('../utils/logger');

const router = Router();

const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const cacheHitRate = new promClient.Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

const cacheMissRate = new promClient.Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});

// Grafana Cloud configuration
const GRAFANA_REMOTE_WRITE_URL = process.env.GRAFANA_REMOTE_WRITE_URL;
const GRAFANA_USERNAME = process.env.GRAFANA_USERNAME;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;
const GRAFANA_PUSH_INTERVAL_MS = parseInt(process.env.GRAFANA_PUSH_INTERVAL_MS || '15000', 10);
const METRICS_SECRET = process.env.METRICS_SECRET;

let gateway = null;

function getGateway() {
  if (gateway) return gateway;

  if (!GRAFANA_REMOTE_WRITE_URL || !GRAFANA_USERNAME || !GRAFANA_API_KEY) {
    return null;
  }

  const auth = Buffer.from(`${GRAFANA_USERNAME}:${GRAFANA_API_KEY}`).toString('base64');

  gateway = new promClient.Pushgateway(
    GRAFANA_REMOTE_WRITE_URL,
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000,
    },
    register
  );

  return gateway;
}

async function pushMetricsToGrafana() {
  const gw = getGateway();
  if (!gw) return;

  try {
    await gw.pushAdd({ jobName: 'cinelink-backend' });
    logger.info('[metrics] Pushed to Grafana Cloud OK');
  } catch (err) {
    logger.warn('[metrics] Push to Grafana Cloud failed', { error: err.message });
  }
}

function initializeGrafanaCloudPush() {
  if (process.env.NODE_ENV === 'production' && GRAFANA_REMOTE_WRITE_URL) {
    setInterval(pushMetricsToGrafana, GRAFANA_PUSH_INTERVAL_MS);
    logger.info('[metrics] Grafana Cloud push enabled', {
      interval: GRAFANA_PUSH_INTERVAL_MS,
      endpoint: GRAFANA_REMOTE_WRITE_URL,
    });
  }
}

function metricsSecurityMiddleware(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const providedSecret = req.headers['x-metrics-token'] || req.headers['authorization'];

  if (!METRICS_SECRET) {
    logger.warn('[metrics] METRICS_SECRET not configured in production - metrics endpoint is open');
    return next();
  }

  if (providedSecret !== METRICS_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

router.get('/', metricsSecurityMiddleware, async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = {
  router,
  register,
  httpRequestDuration,
  httpRequestTotal,
  cacheHitRate,
  cacheMissRate,
  initializeGrafanaCloudPush,
  pushMetricsToGrafana,
};