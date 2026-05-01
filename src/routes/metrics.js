const { Router } = require('express');
const promClient = require('prom-client');
const https = require('https');
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

const GRAFANA_REMOTE_WRITE_URL = process.env.GRAFANA_REMOTE_WRITE_URL;
const GRAFANA_USERNAME = process.env.GRAFANA_USERNAME;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;
const GRAFANA_PUSH_INTERVAL_MS = parseInt(process.env.GRAFANA_PUSH_INTERVAL_MS || '15000', 10);
const METRICS_SECRET = process.env.METRICS_SECRET;

// Parse Prometheus text format into time series for remote write
function parsePrometheusText(text) {
  const timeSeries = [];
  const lines = text.split('\n');
  const nowMs = Date.now();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match: metric_name{labels} value [timestamp]
    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?([^}]*)\}?\s+([\d.eE+\-]+|NaN|[+-]?Inf)(\s+\d+)?$/);
    if (!match) continue;

    const metricName = match[1];
    const labelsStr = match[2];
    const value = parseFloat(match[3]);

    if (isNaN(value) || !isFinite(value)) continue;

    const labels = [{ name: '__name__', value: metricName }];

    if (labelsStr) {
      const labelPairs = labelsStr.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g) || [];
      for (const pair of labelPairs) {
        const [k, v] = pair.split('=');
        labels.push({ name: k, value: v.replace(/^"|"$/g, '') });
      }
    }

    // Sort labels by name (required by Prometheus remote write spec)
    labels.sort((a, b) => a.name.localeCompare(b.name));

    timeSeries.push({
      labels,
      samples: [{ value, timestamp: nowMs }],
    });
  }

  return timeSeries;
}

// Encode WriteRequest as protobuf manually (minimal implementation)
function encodeWriteRequest(timeSeries) {
  // We'll encode using the prometheus protobuf format manually
  // Field 1 (timeseries) = repeated TimeSeries
  const parts = [];

  for (const ts of timeSeries) {
    const tsParts = [];

    // Field 1: repeated Label labels
    for (const label of ts.labels) {
      const labelParts = [];
      // field 1: string name
      const nameBytes = Buffer.from(label.name, 'utf8');
      labelParts.push(encodeField(1, 2, nameBytes));
      // field 2: string value
      const valueBytes = Buffer.from(label.value, 'utf8');
      labelParts.push(encodeField(2, 2, valueBytes));
      const labelBuf = Buffer.concat(labelParts);
      tsParts.push(encodeField(1, 2, labelBuf));
    }

    // Field 2: repeated Sample samples
    for (const sample of ts.samples) {
      const sampleParts = [];
      // field 1: double value
      const valueBuf = Buffer.allocUnsafe(8);
      valueBuf.writeDoubleBE(sample.value, 0);
      // protobuf doubles are little-endian
      valueBuf.writeDoubleLE(sample.value, 0);
      sampleParts.push(encodeField(1, 1, valueBuf));
      // field 2: int64 timestamp
      const tsBuf = encodeVarint(BigInt(sample.timestamp));
      sampleParts.push(Buffer.concat([Buffer.from([0x10]), tsBuf])); // field 2, varint
      const sampleBuf = Buffer.concat(sampleParts);
      tsParts.push(encodeField(2, 2, sampleBuf));
    }

    const tsBuf = Buffer.concat(tsParts);
    parts.push(encodeField(1, 2, tsBuf));
  }

  return Buffer.concat(parts);
}

function encodeField(fieldNumber, wireType, data) {
  const tag = (fieldNumber << 3) | wireType;
  if (wireType === 2) {
    // length-delimited
    return Buffer.concat([encodeVarint(BigInt(tag)), encodeVarint(BigInt(data.length)), data]);
  } else if (wireType === 1) {
    // 64-bit
    return Buffer.concat([encodeVarint(BigInt(tag)), data]);
  }
  return Buffer.concat([encodeVarint(BigInt(tag)), data]);
}

function encodeVarint(value) {
  const bytes = [];
  let v = BigInt(value);
  while (v > 127n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

async function pushMetricsToGrafana() {
  if (!GRAFANA_REMOTE_WRITE_URL || !GRAFANA_USERNAME || !GRAFANA_API_KEY) return;

  let snappy;
  try {
    snappy = require('snappy');
  } catch {
    logger.warn('[metrics] snappy package not installed, skipping push');
    return;
  }

  try {
    const metricsText = await register.metrics();
    const timeSeries = parsePrometheusText(metricsText);

    if (timeSeries.length === 0) {
      logger.debug('[metrics] No time series to push');
      return;
    }

    const protobuf = encodeWriteRequest(timeSeries);
    const compressed = await snappy.compress(protobuf);

    const auth = Buffer.from(`${GRAFANA_USERNAME}:${GRAFANA_API_KEY}`).toString('base64');
    const parsedUrl = new URL(GRAFANA_REMOTE_WRITE_URL);

    const statusCode = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-protobuf',
          'Content-Encoding': 'snappy',
          'X-Prometheus-Remote-Write-Version': '0.1.0',
          'Authorization': `Basic ${auth}`,
          'Content-Length': compressed.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            logger.warn('[metrics] Push failed', { status: res.statusCode, body: data });
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(res.statusCode);
          }
        });
      });
      req.on('error', reject);
      req.write(compressed);
      req.end();
    });

    logger.info('[metrics] Pushed to Grafana Cloud OK', { status: statusCode, series: timeSeries.length });
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
  if (process.env.NODE_ENV !== 'production') return next();

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