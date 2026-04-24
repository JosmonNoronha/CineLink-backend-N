const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errors');
const { env } = require('../config/environment');

function notFoundHandler(req, res) {
  const correlationId = req.correlationId || req.headers['x-correlation-id'];
  return res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      userMessage: 'The requested endpoint does not exist.',
      correlationId,
      retryable: false,
    },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Internal server error';
  const correlationId = err.correlationId || req.correlationId || req.headers['x-correlation-id'];
  const userMessage =
    err.userMessage || (status >= 500 ? 'Something went wrong. Please try again.' : message);
  const retryable = typeof err.retryable === 'boolean' ? err.retryable : status >= 500;
  const logPayload = {
    status,
    code,
    message,
    path: req.originalUrl,
    method: req.method,
    correlationId,
  };

  if (status >= 500) {
    logger.error('Unhandled error', { ...logPayload, stack: err.stack });
  } else {
    logger.warn('Request error', logPayload);
  }

  const payload = {
    success: false,
    error: {
      code,
      message,
      userMessage,
      correlationId,
      retryable,
    },
  };
  if (err instanceof AppError && err.details) {
    payload.error.details = err.details;
  }
  if (env.NODE_ENV !== 'production' && status >= 500) {
    payload.error.stack = err.stack;
  }
  return res.status(status).json(payload);
}

module.exports = { errorHandler, notFoundHandler };
