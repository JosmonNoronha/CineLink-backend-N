'use strict';

const { AppError } = require('../utils/errors');

/**
 * Require that the user signed in recently (Firebase `auth_time` claim), so a stolen or left-open
 * session cannot do something permanent such as deleting the account. The app should then ask for
 * the password again and retry with a fresh token.
 */
function requireRecentLogin({ maxAgeSeconds = 300 } = {}) {
  return (req, _res, next) => {
    const authTime = Number(req.user && req.user.claims && req.user.claims.auth_time);
    const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
    if (!Number.isFinite(authTime) || ageSeconds > maxAgeSeconds || ageSeconds < -60) {
      return next(
        new AppError('Recent sign-in required', 401, 'REAUTH_REQUIRED', undefined, {
          userMessage: 'For your security, please sign in again to continue.',
          retryable: false,
        }),
      );
    }
    return next();
  };
}

module.exports = { requireRecentLogin };
