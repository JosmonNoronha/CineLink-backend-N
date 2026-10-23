'use strict';

const crypto = require('crypto');
const { AppError } = require('../utils/errors');
const { getAuth } = require('../config/firebase');
const { logger } = require('../utils/logger');

/**
 * Permission gate for routes that already ran authMiddleware.
 * Permissions come from Firebase custom claims (see deriveAuthorizationContext in auth.js).
 *
 * For admin and moderator permissions the token is also re-checked with Firebase (checkRevoked),
 * so removing someone's role, disabling the account or revoking their sessions takes effect within
 * about a minute instead of lasting until their ID token expires (up to an hour, and the regular
 * token cache keeps tokens for 5 minutes). Ordinary user routes are not affected and stay fast.
 */
const PRIVILEGED = new Set(['content:moderate', 'admin:all']);
const RECHECK_TTL_MS = 60 * 1000;
const MAX_REMEMBERED = 500;
const recentlyConfirmed = new Map(); // sha256(token) -> expires at (ms)

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function confirmStillPrivileged(req) {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError('Missing authentication', 401, 'UNAUTHORIZED');

  const key = hash(token);
  const until = recentlyConfirmed.get(key);
  if (until && until > Date.now()) return;

  try {
    await getAuth().verifyIdToken(token, true);
  } catch (err) {
    const code = String((err && err.code) || '');
    if (
      code === 'auth/id-token-revoked' ||
      code === 'auth/user-disabled' ||
      code === 'auth/user-not-found' ||
      code === 'auth/id-token-expired' ||
      code === 'auth/argument-error' ||
      code.startsWith('auth/invalid')
    ) {
      recentlyConfirmed.delete(key);
      throw new AppError('Session no longer valid', 401, 'TOKEN_REVOKED', undefined, {
        userMessage: 'Your session has ended. Please sign in again.',
        retryable: false,
      });
    }
    // Could not reach Firebase: for privileged actions, refuse rather than guess.
    logger.warn('Privileged token re-check failed', { code, error: err && err.message });
    throw new AppError('Could not verify session', 503, 'AUTH_UNAVAILABLE', undefined, {
      userMessage: 'Please try again in a moment.',
      retryable: true,
    });
  }

  recentlyConfirmed.set(key, Date.now() + RECHECK_TTL_MS);
  if (recentlyConfirmed.size > MAX_REMEMBERED) {
    const now = Date.now();
    for (const [k, exp] of recentlyConfirmed) if (exp <= now) recentlyConfirmed.delete(k);
    while (recentlyConfirmed.size > MAX_REMEMBERED) recentlyConfirmed.delete(recentlyConfirmed.keys().next().value);
  }
}

function requirePermission(...needed) {
  const privileged = needed.some((p) => PRIVILEGED.has(p));
  return async (req, _res, next) => {
    if (!req.user) return next(new AppError('Missing authentication', 401, 'UNAUTHORIZED'));
    const have = req.user.permissions || [];
    if (!needed.every((p) => have.includes(p))) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    }
    if (!privileged) return next();
    try {
      await confirmStillPrivileged(req);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function _resetForTests() {
  recentlyConfirmed.clear();
}

module.exports = { requirePermission, _resetForTests };
