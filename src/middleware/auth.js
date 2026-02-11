const { getAuth } = require('../config/firebase');
const { AppError } = require('../utils/errors');
const { logger } = require('../utils/logger');
const { Buffer } = require('buffer');

// Simple in-memory token cache to avoid slow Firebase verification
// Cache tokens for 5 minutes to bypass 12+ second Firebase public key fetches
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

function getCachedToken(token) {
  const cached = tokenCache.get(token);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > TOKEN_CACHE_TTL) {
    tokenCache.delete(token);
    return null;
  }
  return cached.decoded;
}

function cacheToken(token, decoded) {
  tokenCache.set(token, { decoded, timestamp: Date.now() });
  // Cleanup old entries if cache grows too large
  if (tokenCache.size > 1000) {
    const entries = Array.from(tokenCache.entries());
    const now = Date.now();
    entries.forEach(([key, value]) => {
      if (now - value.timestamp > TOKEN_CACHE_TTL) {
        tokenCache.delete(key);
      }
    });
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
    const cached = getCachedToken(token);
    if (cached) {
      req.user = {
        uid: cached.uid,
        email: cached.email,
        name: cached.name,
        picture: cached.picture,
        claims: cached,
      };
      return next();
    }

    const decoded = await getAuth().verifyIdToken(token);
    cacheToken(token, decoded);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded,
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
    const cached = getCachedToken(token);
    if (cached) {
      req.user = {
        uid: cached.uid,
        email: cached.email,
        name: cached.name,
        picture: cached.picture,
        claims: cached,
      };
      return next();
    }

    // Verify token
    const decoded = await getAuth().verifyIdToken(token);
    cacheToken(token, decoded);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      claims: decoded,
    };
    next();
  } catch (err) {
    // On error, just continue without auth
    logger.debug('Optional auth failed, continuing without user', { error: err.message });
    next();
  }
}

module.exports = { authMiddleware, optionalAuth };
