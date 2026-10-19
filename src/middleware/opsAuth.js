'use strict';

/**
 * Shared-secret protection for operational endpoints (Prometheus scrape, status dashboard).
 *
 * These are machine / operator surfaces, not user features, so they use a long random
 * secret rather than Firebase login. Rules:
 *  - fail closed: no secret configured => the endpoint is unavailable (in every environment);
 *  - constant-time comparison (digests of equal length through timingSafeEqual);
 *  - credential accepted as `Authorization: Bearer <secret>` (what Prometheus sends),
 *    `Authorization: Basic base64(any:<secret>)` (browser prompt), or `X-Ops-Token` / `X-Metrics-Token`;
 *  - a bare `Authorization: <secret>` (no scheme) is NOT accepted;
 *  - failed attempts are rate limited per IP.
 */

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/environment');
const { logger } = require('../utils/logger');

const MIN_SECRET_LENGTH = 24;

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

const getOpsSecret = () => env.OPS_SECRET || env.METRICS_SECRET || '';

function credentialFromHeaders(headers = {}) {
  const token = headers['x-ops-token'] || headers['x-metrics-token'];
  if (token) return String(token);

  const [scheme, value] = String(headers.authorization || '').split(' ');
  if (!value) return '';
  if (/^bearer$/i.test(scheme)) return value;
  if (/^basic$/i.test(scheme)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx >= 0 ? decoded.slice(idx + 1) : decoded;
  }
  return '';
}

function hasValidOpsCredential(headers) {
  const secret = getOpsSecret();
  if (!secret) return false;
  const provided = credentialFromHeaders(headers);
  return provided ? safeEqual(provided, secret) : false;
}

const failedAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed attempts' },
});

if (getOpsSecret() && getOpsSecret().length < MIN_SECRET_LENGTH) {
  logger.warn(`OPS_SECRET / METRICS_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; use a long random value`);
}

/**
 * @param {object} opts
 * @param {boolean} opts.challenge  true => 401 + WWW-Authenticate (browser login prompt); false => 403 JSON
 * @param {string} opts.name        used in the "not configured" message
 * @returns {Function[]} express middleware chain
 */
function requireOpsAuth({ challenge = false, name = 'Ops' } = {}) {
  const check = (req, res, next) => {
    if (!getOpsSecret()) {
      logger.error(`[ops] ${name} endpoint requested but OPS_SECRET/METRICS_SECRET is not configured`);
      return res.status(503).json({ error: `${name} endpoint not configured` });
    }
    if (hasValidOpsCredential(req.headers)) return next();

    if (challenge) {
      res.set('WWW-Authenticate', 'Basic realm="CineLink ops", charset="UTF-8"');
      return res.status(401).send('Authentication required');
    }
    return res.status(403).json({ error: 'Forbidden' });
  };
  return [failedAttemptLimiter, check];
}

module.exports = { requireOpsAuth, hasValidOpsCredential, credentialFromHeaders, safeEqual, getOpsSecret };
