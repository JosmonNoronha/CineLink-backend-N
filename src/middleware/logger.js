const morgan = require('morgan');
const { logger } = require('../utils/logger');

const requestLogger = morgan('combined', {
  stream: {
    write: (message) => logger.http(message.trim()),
  },
});

module.exports = { requestLogger };
