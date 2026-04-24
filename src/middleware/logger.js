const morgan = require('morgan');
const { logger } = require('../utils/logger');

morgan.token('correlation-id', (req) => req.correlationId || req.headers['x-correlation-id'] || '-');

const requestLogger = morgan(
  ':remote-addr - :remote-user [:date[iso]] ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms cid=:correlation-id',
  {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
  }
);

module.exports = { requestLogger };
