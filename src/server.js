const { createApp } = require('./app');
const { env } = require('./config/environment');
const { logger } = require('./utils/logger');

async function gracefulShutdown(server, signal, err) {
  try {
    logger.info(`Shutdown initiated (${signal || 'unknown'})`);

    // Stop accepting new connections
    if (server && server.close) {
      logger.info('Closing HTTP server to new connections');
      await new Promise((resolve, reject) => {
        server.close((closeErr) => {
          if (closeErr) return reject(closeErr);
          return resolve();
        });
      });
      logger.info('HTTP server closed');
    }

    // Flush Sentry (if configured)
    try {
      // require lazily so Sentry only loaded if used
      // eslint-disable-next-line global-require
      const Sentry = require('@sentry/node');
      if (Sentry && typeof Sentry.close === 'function') {
        logger.info('Flushing Sentry events');
        // wait up to 2s for Sentry to flush
        // Sentry.close returns a Promise
        // eslint-disable-next-line no-await-in-loop
        await Sentry.close(2000);
        logger.info('Sentry flushed');
      }
    } catch (e) {
      logger.warn('Sentry flush skipped or failed:', e && e.message ? e.message : String(e));
    }

    // Disconnect Redis if it's ready
    try {
      // eslint-disable-next-line global-require
      const { isRedisReady, getRedisClient } = require('./config/redis');
      if (isRedisReady && isRedisReady()) {
        logger.info('Disconnecting Redis client');
        const redisClient = await getRedisClient();
        if (redisClient && typeof redisClient.quit === 'function') {
          await redisClient.quit();
          logger.info('Redis client disconnected');
        } else if (redisClient && typeof redisClient.disconnect === 'function') {
          redisClient.disconnect();
          logger.info('Redis client disconnected (disconnect())');
        }
      }
    } catch (e) {
      logger.warn('Redis shutdown skipped or failed:', e && e.message ? e.message : String(e));
    }

    // Delete Firebase app to allow clean shutdown
    try {
      // eslint-disable-next-line global-require
      const { getFirebaseApp } = require('./config/firebase');
      const fb = getFirebaseApp();
      if (fb && typeof fb.delete === 'function') {
        logger.info('Deleting Firebase Admin app');
        // eslint-disable-next-line no-await-in-loop
        await fb.delete();
        logger.info('Firebase Admin app deleted');
      }
    } catch (e) {
      logger.warn('Firebase app shutdown skipped or failed:', e && e.message ? e.message : String(e));
    }

    logger.info('Shutdown complete, exiting process');
    // exit with error code if one was provided
    process.exit(err ? 1 : 0);
  } catch (shutdownErr) {
    logger.error('Error during graceful shutdown', shutdownErr);
    process.exit(1);
  }
}

async function main() {
  const app = await createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`CineLink backend listening on :${env.PORT}`);
  });

  // Generic termination handlers
  const handleSignal = (signal) => {
    logger.info(`Received signal ${signal}, starting graceful shutdown`);
    // allow 10s for graceful shutdown then force exit
    const force = setTimeout(() => {
      logger.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
    force.unref();
    gracefulShutdown(server, signal).catch((e) => {
      logger.error('Graceful shutdown failed', e);
      process.exit(1);
    });
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err && err.stack ? err.stack : String(err));
    // try to gracefully shutdown
    gracefulShutdown(server, 'uncaughtException', err).catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason && reason.stack ? reason.stack : String(reason));
    // try to gracefully shutdown
    gracefulShutdown(server, 'unhandledRejection', reason).catch(() => process.exit(1));
  });
}

main().catch((err) => {
  logger.error('Failed to start application', err);
  process.exit(1);
});
