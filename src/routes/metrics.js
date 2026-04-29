const { Router } = require('express');
const https = require('https');
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

// Grafana Cloud remote write configuration
const GRAFANA_REMOTE_WRITE_URL = process.env.GRAFANA_REMOTE_WRITE_URL;
const GRAFANA_USERNAME = process.env.GRAFANA_USERNAME;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;
const GRAFANA_PUSH_INTERVAL_MS = parseInt(process.env.GRAFANA_PUSH_INTERVAL_MS || '15000', 10);
const METRICS_SECRET = process.env.METRICS_SECRET;

/**
 * Push metrics to Grafana Cloud via remote write endpoint
 */
async function pushMetricsToGrafana() {
  if (!GRAFANA_REMOTE_WRITE_URL || !GRAFANA_USERNAME || !GRAFANA_API_KEY) {
    return; // skip if not configured (local dev)
  }

  try {
    const metrics = await register.metrics();
    const auth = Buffer.from(`${GRAFANA_USERNAME}:${GRAFANA_API_KEY}`).toString('base64');

    const url = new URL(GRAFANA_REMOTE_WRITE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(metrics),
      },
    };

    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Push failed with status ${res.statusCode}: ${data}`));
          } else {
            resolve();
          }
        });
      });
      req.on('error', reject);
      req.write(metrics);
      req.end();
    });

    logger.debug('[metrics] Successfully pushed metrics to Grafana Cloud');
  } catch (err) {
    logger.warn('[metrics] Push to Grafana Cloud failed:', { error: err.message });
  }
}

/**
 * Initialize Grafana Cloud push (only in production)
 */
function initializeGrafanaCloudPush() {
  if (process.env.NODE_ENV === 'production' && GRAFANA_REMOTE_WRITE_URL) {
    setInterval(pushMetricsToGrafana, GRAFANA_PUSH_INTERVAL_MS);
    logger.info('[metrics] Grafana Cloud push enabled', {
      interval: GRAFANA_PUSH_INTERVAL_MS,
      endpoint: GRAFANA_REMOTE_WRITE_URL,
    });
  }
}

// Middleware to secure /metrics endpoint in production
function metricsSecurityMiddleware(req, res, next) {
  // Allow unrestricted access in development
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // In production, require METRICS_SECRET header
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
