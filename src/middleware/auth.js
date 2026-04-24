const { getAuth } = require('../config/firebase');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const { Buffer } = require('buffer');
const TokenCacheService = require('../services/tokenCache');
const { getRedisClient } = require('../config/redis');

// Token cache service - uses Redis with in-memory fallback
let tokenCacheService = null;

function getTokenCacheService() {
  if (!tokenCacheService) {
    const redisClient = getRedisClient();
    tokenCacheService = new TokenCacheService(redisClient);
  }
  return tokenCacheService;
}

function deriveAuthorizationContext(claims = {}) {
  const roles = [];
  if (claims.admin === true) roles.push('admin');
  if (claims.moderator === true) roles.push('moderator');
  if (!roles.length) roles.push('user');

  const permissions = new Set(['user:read', 'user:write']);
  if (roles.includes('moderator')) permissions.add('content:moderate');
  if (roles.includes('admin')) {
    permissions.add('content:moderate');
    permissions.add('admin:all');
  }

  return {
    roles,
    permissions: Array.from(permissions),
  };
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;

    const payloadB64Url = parts[1];
    const payloadB64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64.padEnd(Math.ceil(payloadB64.length / 4) * 4, '=');

    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_e) {
    return null;
  }
}

async function authMiddleware(req, _res, next) {
  const startTime = Date.now();
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError('Missing Authorization bearer token', 401, 'UNAUTHORIZED');
    }

    // Check cache first to avoid slow Firebase verification
    const cache = getTokenCacheService();
    let cached = await cache.getToken(token);

    // Check if token is revoked
    if (cached) {
      const isRevoked = await cache.isRevoked(token);
      if (isRevoked) {
        cached = null;
      }
    }

    if (cached) {
      const authz = deriveAuthorizationContext(cached);
      req.user = {
        uid: cached.uid,
        email: cached.email,
        name: cached.name,
        picture: cached.picture,
        claims: cached,
        roles: authz.roles,
        permissions: authz.permissions,
      };
      return next();
    }

    const decoded = await getAuth().verifyIdToken(token);
    await cache.cacheToken(token, decoded);
    const authz = deriveAuthorizationContext(decoded);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded,
      roles: authz.roles,
      permissions: authz.permissions,
    };
    next();
  } catch (err) {
    if (err.statusCode) return next(err);

    // Helpful diagnostics when Firebase token verification fails.
    // Do NOT log the raw token.
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const payload = decodeJwtPayload(token);
    const diag = payload
      ? {
          aud: payload.aud,
          iss: payload.iss,
          sub: payload.sub,
          iat: payload.iat,
          exp: payload.exp,
        }
      : { payload: null };

    logger.warn({
      message: 'Token verification failed',
      path: req.path,
      reason: err.message,
      code: err.code,
      ...diag,
    });

    const reason = String(err && err.message ? err.message : '');
    const code = String(err && err.code ? err.code : '');
    if (
      code === 'app/invalid-credential' ||
      reason.includes('FIREBASE_SERVICE_ACCOUNT_JSON') ||
      reason.includes('credential') ||
      reason.includes('Failed to parse private key') ||
      reason.includes('Invalid PEM') ||
      reason.includes('initializeApp')
    ) {
      return next(new AppError('Firebase Admin misconfigured', 500, 'AUTH_CONFIG_ERROR'));
    }

    return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
  }
}

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      // No token provided, continue without auth
      return next();
    }

    // Check cache first
    const cache = getTokenCacheService();
    let cached = await cache.getToken(token);

    if (cached) {
      const isRevoked = await cache.isRevoked(token);
      if (!isRevoked) {
        const authz = deriveAuthorizationContext(cached);
        req.user = {
          uid: cached.uid,
          email: cached.email,
          name: cached.name,
          picture: cached.picture,
          claims: cached,
          roles: authz.roles,
          permissions: authz.permissions,
        };
        return next();
      }
    }

    // Verify token
    const decoded = await getAuth().verifyIdToken(token);
    await cache.cacheToken(token, decoded);
    const authz = deriveAuthorizationContext(decoded);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded,
      roles: authz.roles,
      permissions: authz.permissions,
    };
    next();
  } catch (err) {
    // On error, just continue without auth
    logger.debug('Optional auth failed, continuing without user', { error: err.message });
    next();
  }
}

module.exports = { authMiddleware, optionalAuth };
