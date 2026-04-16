const { createClient } = require('redis');
const { env } = require('./environment');
const { logger } = require('../utils/logger');

let redisClient;
let redisReady = false;
let redisAvailable = false;
let reconnectTimer = null;
let reconnectInProgress = false;
let lastReconnectAttemptAt = 0;

const redisConnectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3000);
const redisReconnectCooldownMs = Number(process.env.REDIS_RECONNECT_COOLDOWN_MS || 60_000);

function setRedisAvailability(available) {
  redisAvailable = available;
  if (!available) {
    redisReady = false;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnectAttempt(reason = 'unknown', force = false) {
  if (!env.REDIS_URL || redisAvailable || reconnectTimer || (!force && reconnectInProgress)) {
    return;
  }

  const now = Date.now();
  const elapsed = now - lastReconnectAttemptAt;
  const delayMs = Math.max(0, redisReconnectCooldownMs - elapsed);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void attemptReconnect('scheduled');
  }, delayMs);

  if (typeof reconnectTimer.unref === 'function') {
    reconnectTimer.unref();
  }

  logger.info('Redis reconnect scheduled', {
    reason,
    delayMs,
    cooldownMs: redisReconnectCooldownMs,
  });
}

async function cleanupRedisClient() {
  if (!redisClient) return;

  try {
    if (redisClient.isOpen && typeof redisClient.disconnect === 'function') {
      redisClient.disconnect();
    }
  } catch (_e) {
    // no-op
  }

  redisClient = null;
}

function markRedisUnavailable(reason = 'runtime-error') {
  setRedisAvailability(false);
  scheduleReconnectAttempt(reason);
}

async function attemptReconnect(reason = 'manual') {
  if (reconnectInProgress || redisAvailable || !env.REDIS_URL) {
    return redisClient;
  }

  reconnectInProgress = true;
  lastReconnectAttemptAt = Date.now();
  logger.info('Attempting Redis reconnect', { reason });

  try {
    await cleanupRedisClient();
    const client = await initializeRedis();
    if (isRedisReady()) {
      logger.info('Redis reconnect succeeded; cache restored');
    }
    return client;
  } catch (_e) {
    return null;
  } finally {
    reconnectInProgress = false;
    if (!isRedisReady()) {
      scheduleReconnectAttempt('reconnect-not-ready', true);
    }
  }
}

async function initializeRedis() {
  if (!env.REDIS_URL) {
    logger.info('Redis URL not configured, skipping Redis initialization');
    clearReconnectTimer();
    setRedisAvailability(false);
    return null;
  }

  if (redisClient && isRedisReady()) return redisClient;

  if (redisClient && !isRedisReady()) {
    await cleanupRedisClient();
  }

  try {
    // Trim and validate URL format
    const redisUrl = env.REDIS_URL.trim();

    // Basic validation
    if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      logger.error('Redis URL must start with redis:// or rediss://');
      setRedisAvailability(false);
      return null;
    }

    // Log sanitized URL (hide password)
    const sanitizedUrl = redisUrl.replace(/:([^@]+)@/, ':****@');
    logger.info(`Attempting Redis connection to: ${sanitizedUrl}`);

    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: redisConnectTimeoutMs,
        reconnectStrategy: false,
      },
    });
    setRedisAvailability(true);

    redisClient.on('error', (err) => {
      setRedisAvailability(false);
      redisReady = false;
      logger.warn(`Redis error: ${err.message}`);
      scheduleReconnectAttempt('client-error');
    });

    redisClient.on('end', () => {
      setRedisAvailability(false);
      logger.warn('Redis connection closed');
      scheduleReconnectAttempt('client-end');
    });

    redisClient.on('ready', () => {
      redisReady = true;
      setRedisAvailability(true);
      logger.info('Redis ready');
    });

    redisClient.on('connect', () => {
      logger.info('Redis connecting...');
    });

    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Redis connect timeout after ${redisConnectTimeoutMs}ms`)),
          redisConnectTimeoutMs
        );
      }),
    ]);

    return redisClient;
  } catch (error) {
    logger.warn('Redis unavailable, continuing without Redis', { error: error.message });
    await cleanupRedisClient();
    setRedisAvailability(false);
    scheduleReconnectAttempt('init-failed');
    return null;
  }
}

function getRedisClient() {
  if (!isRedisReady()) {
    scheduleReconnectAttempt('client-requested-while-unavailable');
    return null;
  }
  return redisClient;
}

function isRedisReady() {
  return redisAvailable && !!redisClient && redisClient.isOpen && redisReady;
}

module.exports = { initializeRedis, getRedisClient, isRedisReady, markRedisUnavailable };
