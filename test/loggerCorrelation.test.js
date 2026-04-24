const { logger } = require('../src/utils/logger');
const { runWithRequestContext } = require('../src/utils/requestContext');

describe('logger correlation context', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('injects correlationId from request context into log entries', async () => {
    const transport = logger.transports[0];
    const logSpy = jest.spyOn(transport, 'log').mockImplementation((info, callback) => {
      if (typeof callback === 'function') callback();
    });

    runWithRequestContext({ correlationId: 'cid-123' }, () => {
      logger.info('context log message');
    });

    expect(logSpy).toHaveBeenCalled();
    const info = logSpy.mock.calls[0][0];
    expect(info).toMatchObject({
      message: 'context log message',
      correlationId: 'cid-123',
    });
  });

  test('does not override explicit correlationId in log payload', () => {
    const transport = logger.transports[0];
    const logSpy = jest.spyOn(transport, 'log').mockImplementation((info, callback) => {
      if (typeof callback === 'function') callback();
    });

    runWithRequestContext({ correlationId: 'cid-context' }, () => {
      logger.info('explicit log message', { correlationId: 'cid-explicit' });
    });

    const info = logSpy.mock.calls[0][0];
    expect(info.correlationId).toBe('cid-explicit');
  });
});
