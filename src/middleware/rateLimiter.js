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

module.exports = { globalLimiter, searchLimiter };
