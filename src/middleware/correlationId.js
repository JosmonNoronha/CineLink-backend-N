const { randomUUID } = require('crypto');
const { runWithRequestContext } = require('../utils/requestContext');

function correlationIdMiddleware(req, res, next) {
  const incomingCorrelationId = req.headers['x-correlation-id'];
  const correlationId =
    typeof incomingCorrelationId === 'string' && incomingCorrelationId.trim().length > 0
      ? incomingCorrelationId.trim()
      : randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  runWithRequestContext({ correlationId }, () => next());
}

module.exports = { correlationIdMiddleware };
