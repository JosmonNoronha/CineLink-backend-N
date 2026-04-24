const { AppError } = require('./errors');

class NetworkError extends AppError {
  constructor(message = 'Network error', options = {}) {
    super(message, 503, 'NETWORK_ERROR', options.details, {
      userMessage: options.userMessage || 'Service is temporarily unavailable. Please try again.',
      retryable: options.retryable !== undefined ? options.retryable : true,
      correlationId: options.correlationId,
    });
  }
}

class AuthError extends AppError {
  constructor(message = 'Unauthorized', options = {}) {
    super(message, 401, 'UNAUTHORIZED', options.details, {
      userMessage: options.userMessage || 'Your session has expired. Please sign in again.',
      retryable: false,
      correlationId: options.correlationId,
    });
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = [], options = {}) {
    super(message, 400, 'VALIDATION_ERROR', details, {
      userMessage: options.userMessage || 'Please check your input and try again.',
      retryable: false,
      correlationId: options.correlationId,
    });
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', options = {}) {
    super(message, 429, 'RATE_LIMITED', options.details, {
      userMessage: options.userMessage || 'Too many requests. Please wait before trying again.',
      retryable: true,
      correlationId: options.correlationId,
    });
  }
}

class CacheError extends AppError {
  constructor(message = 'Cache operation failed', options = {}) {
    super(message, 503, 'CACHE_ERROR', options.details, {
      userMessage: options.userMessage || 'Temporary service issue. Please retry shortly.',
      retryable: true,
      correlationId: options.correlationId,
    });
  }
}

module.exports = {
  NetworkError,
  AuthError,
  ValidationError,
  RateLimitError,
  CacheError,
};
