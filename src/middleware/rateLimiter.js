const rateLimit = require('express-rate-limit');
const { env } = require('../config/environment');

const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.SEARCH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

const gamificationActionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req?.user?.uid || req.ip,
});

const batchDetailsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req?.user?.uid || req.ip,
});

const suggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
});

   const accountDeletionLimiter = rateLimit({
     windowMs: 60 * 60 * 1000,
     limit: 5,
     standardHeaders: true,
     legacyHeaders: false,
     keyGenerator: (req) => req?.user?.uid || req.ip,
   });

module.exports = { globalLimiter, searchLimiter, gamificationActionLimiter, batchDetailsLimiter, suggestLimiter, accountDeletionLimiter, };
