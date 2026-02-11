require('express-async-errors'); // Must be imported before other modules
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const Sentry = require('@sentry/node');
const statusMonitor = require('express-status-monitor');

const { env } = require('./config/environment');
const { requestLogger } = require('./middleware/logger');
const { createMetricsMiddleware, analyticsMiddleware } = require('./middleware/metrics');
const { globalLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const { logger } = require('./utils/logger');
const { initializeFirebase } = require('./config/firebase');
const { initializeRedis } = require('./config/redis');
const { analyticsService } = require('./services/analytics');

async function createApp() {
  // Initialize Firebase Admin SDK immediately to avoid cold-start issues
  try {
    await initializeFirebase(); // Changed from getFirebaseApp() to async call
    logger.info('Firebase Admin SDK initialized successfully');

    // Warm up JWT verification to pre-fetch Google's public keys
    // This prevents 20+ second delays on first token verification
    const { warmupJwtVerification, warmupFirestore } = require('./config/firebase');
    await warmupJwtVerification();

    // Warm up Firestore connection to prevent delays on first database query
    await warmupFirestore();
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK:', error);
    throw error;
  }

  // Initialize Redis (optional - app works without it)
  try {
    const redisClient = await initializeRedis();
    if (redisClient) {
      logger.info('Redis initialized successfully');
    } else {
      logger.info('Redis disabled - app will run without caching');
    }
  } catch (error) {
    logger.warn('Redis initialization failed, continuing without Redis', { error: error.message });
  }

  // Initialize analytics service
  analyticsService.initialize();

  const app = express();

  // Status monitor dashboard
  app.use(
    statusMonitor({
      title: 'CineLink API Status',
      path: '/status-monitor',
      spans: [
        {
          interval: 1, // Every second
          retention: 60, // Keep 60 datapoints (1 minute)
        },
        {
          interval: 5, // Every 5 seconds
          retention: 60, // Keep 60 datapoints (5 minutes)
        },
        {
          interval: 15, // Every 15 seconds
          retention: 60, // Keep 60 datapoints (15 minutes)
        },
      ],
      chartVisibility: {
        cpu: true,
        mem: true,
        load: true,
        responseTime: true,
        rps: true,
        statusCodes: true,
      },
      healthChecks: [
        {
          protocol: 'http',
          host: 'localhost',
          path: '/api/health',
          port: env.PORT,
        },
      ],
    })
  );

  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
    app.use(Sentry.Handlers.requestHandler());
  }

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  const allowedOrigins = env.CORS_ORIGIN;
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.length === 0) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);

        // Developer experience: Expo Web runs on localhost with a dynamic port (often :8081).
        // Allow common local origins in non-production even if not explicitly listed.
        if (env.NODE_ENV !== 'production') {
          const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
          if (isLocalhost) return cb(null, true);
        }

        // Do not throw: returning false avoids noisy 500s and lets browsers enforce CORS.
        return cb(null, false);
      },
      credentials: true,
      optionsSuccessStatus: 200,
    })
  );

  app.use(requestLogger);
  app.use(createMetricsMiddleware());
  app.use(analyticsMiddleware);
  app.use(globalLimiter);

  app.use(env.API_PREFIX, routes);
  app.use(notFoundHandler);

  if (env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
  }
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
