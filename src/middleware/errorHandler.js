const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    logger.error('Unhandled error', { message: err.message, stack: err.stack, path: req.originalUrl });
  } else {
    logger.warn('Request error', { status, code, message, path: req.originalUrl });
  }

  const payload = {
    success: false,
    error: { code, message },
  };
  if (err instanceof AppError && err.details) {
    payload.error.details = err.details;
  }
  return res.status(status).json(payload);
}

module.exports = { errorHandler, notFoundHandler };
