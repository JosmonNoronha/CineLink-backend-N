const winston = require('winston');
const { env } = require('../config/environment');
const { getRequestContext } = require('./requestContext');

const attachCorrelationId = winston.format((info) => {
  const requestContext = getRequestContext();
  if (requestContext && requestContext.correlationId && !info.correlationId) {
    info.correlationId = requestContext.correlationId;
  }
  return info;
});

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    attachCorrelationId(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

module.exports = { logger };
