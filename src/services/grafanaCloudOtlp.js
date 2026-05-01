let MeterProvider;
let PeriodicExportingMetricReader;
let OTLPMetricExporter;

try {
  // Optional dependency set: the app still runs without Grafana Cloud configured.
  // eslint-disable-next-line global-require
  ({ MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics'));
  // eslint-disable-next-line global-require
  ({ OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http'));
} catch (_error) {
  MeterProvider = null;
  PeriodicExportingMetricReader = null;
  OTLPMetricExporter = null;
}

const { logger } = require('../utils/logger');

let initialized = false;
let metricProvider;
let metricReader;
let httpRequestDuration;
let httpRequestTotal;
let cacheHitTotal;
let cacheMissTotal;

function parseHeaderString(headerString) {
  if (!headerString) return {};

  return headerString
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) return accumulator;

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key) return accumulator;

      accumulator[key] = value;
      return accumulator;
    }, {});
}

function initializeGrafanaCloudOtlp() {
  if (initialized) return true;
  if (process.env.NODE_ENV !== 'production') return false;
  if (!MeterProvider || !PeriodicExportingMetricReader || !OTLPMetricExporter) {
    logger.debug('[otel] Grafana Cloud OTLP packages are not installed; skipping export');
    return false;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return false;

  try {
    const exporter = new OTLPMetricExporter({
      url: endpoint,
      headers: parseHeaderString(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    });

    metricReader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 15000),
    });

    metricProvider = new MeterProvider({
      readers: [metricReader],
    });

    const meter = metricProvider.getMeter('cinelink-backend');

    httpRequestDuration = meter.createHistogram('http_request_duration_seconds', {
      description: 'Duration of HTTP requests in seconds',
      unit: 's',
    });
    httpRequestTotal = meter.createCounter('http_requests_total', {
      description: 'Total number of HTTP requests',
    });
    cacheHitTotal = meter.createCounter('cache_hits_total', {
      description: 'Total number of cache hits',
    });
    cacheMissTotal = meter.createCounter('cache_misses_total', {
      description: 'Total number of cache misses',
    });

    initialized = true;
    logger.info('[otel] Grafana Cloud OTLP export enabled', {
      endpoint,
      intervalMs: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 15000),
    });

    return true;
  } catch (error) {
    logger.warn('[otel] Failed to initialize Grafana Cloud OTLP export', {
      error: error.message,
    });
    return false;
  }
}

function recordHttpRequest({ method, route, statusCode, durationSeconds }) {
  if (!initialized) return;

  const attributes = {
    method,
    route,
    status_code: String(statusCode),
  };

  httpRequestTotal.add(1, attributes);
  httpRequestDuration.record(durationSeconds, attributes);
}

function recordCacheHit(cacheType) {
  if (!initialized) return;
  cacheHitTotal.add(1, { cache_type: cacheType });
}

function recordCacheMiss(cacheType) {
  if (!initialized) return;
  cacheMissTotal.add(1, { cache_type: cacheType });
}

module.exports = {
  initializeGrafanaCloudOtlp,
  recordHttpRequest,
  recordCacheHit,
  recordCacheMiss,
};
