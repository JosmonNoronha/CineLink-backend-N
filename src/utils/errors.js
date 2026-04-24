class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = undefined, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.userMessage = options.userMessage || message;
    this.retryable = Boolean(options.retryable);
    this.correlationId = options.correlationId;
  }
}

module.exports = { AppError };
