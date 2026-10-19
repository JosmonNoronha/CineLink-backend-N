'use strict';

const { AppError } = require('../utils/errors');

/**
 * Permission gate for routes that already ran authMiddleware.
 * Permissions come from Firebase custom claims (see deriveAuthorizationContext in auth.js).
 */
function requirePermission(...needed) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('Missing authentication', 401, 'UNAUTHORIZED'));
    const have = req.user.permissions || [];
    if (!needed.every((p) => have.includes(p))) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    }
    return next();
  };
}

module.exports = { requirePermission };
