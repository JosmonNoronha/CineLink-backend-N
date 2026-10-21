const { createClient } = require('redis');
const { env } = require('./environment');
const { logger } = require('../utils/logger');

/*
  One Redis client for the life of the process.

  The old version created a brand-new client after every drop and tore down the healthy one whenever
  a single command failed. Anything that had grabbed the old client (the token cache did) was left
  holding a dead connection. Now node-redis reconnects the SAME client with backoff, so references
  stay valid, and commands fail fast while disconnected so callers fall back to memory.
*/

let redisClient = null;

const connectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10_000);
const ERROR_LOG_EVERY_MS = 30_000;
let lastErrorLogAt = 0;

/** 250ms, 500ms, 1s ... capped at 15s, plus jitter. Never gives up. */
function reconnectStrategy(retries) {
  const base = Math.min(250 * 2 ** Math.min(retries, 6), 15_000);
  return base + Math.floor(Math.random() * 250);
}

function isRedisReady() {
  return !!redisClient && redisClient.isReady === true;
}

/** The live client, or null while Redis is off or reconnecting. Call this each time; do not keep the result. */
function getRedisClient() {
  return isRedisReady() ? redisClient : null;
}

/**
 * Kept so existing callers keep working. A failed command no longer disconnects anything:
 * the client reconnects by itself when the socket really drops.
 */
function markRedisUnavailable(reason = 'command-error') {
  logger.debug('Redis command failed (connection left as is)', { reason });
}

async function initializeRedis() {
  if (!env.REDIS_URL) {
    logger.info('Redis URL not configured, skipping Redis initialization');
    return null;
  }
  if (redisClient) return isRedisReady() ? redisClient : null;

  const redisUrl = env.REDIS_URL.trim();
  if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    logger.error('Redis URL must start with redis:// or rediss://');
    return null;
  }
  if (redisUrl.startsWith('redis://') && !/^redis:\/\/(127\.0\.0\.1|localhost)/.test(redisUrl)) {
    logger.warn('Redis URL uses redis:// (no TLS). Hosted Redis such as Upstash needs rediss://');
  }

  const sanitizedUrl = redisUrl.replace(/\/\/[^@/]*@/, '//****@');
  logger.info(`Attempting Redis connection to: ${sanitizedUrl}`);

  const client = createClient({
    url: redisUrl,
    disableOfflineQueue: true, // while disconnected, commands fail at once instead of piling up
    socket: { connectTimeout: connectTimeoutMs, reconnectStrategy },
  });
  redisClient = client;

  client.on('error', (err) => {
    const now = Date.now();
    if (now - lastErrorLogAt >= ERROR_LOG_EVERY_MS) {
      lastErrorLogAt = now;
      logger.warn(`Redis error: ${err.message}`);
    }
  });
  client.on('ready', () => logger.info('Redis ready'));
  client.on('end', () => logger.warn('Redis connection closed'));
  client.on('reconnecting', () => logger.debug('Redis reconnecting'));

  // connect() keeps retrying in the background, so it may never settle. Do not wait forever:
  // the app starts without Redis and picks it up as soon as the client becomes ready.
  const connecting = client.connect().catch((error) => {
    logger.warn('Redis connect failed', { error: error.message });
  });
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), connectTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  const result = await Promise.race([connecting.then(() => 'done'), timeout]);
  clearTimeout(timer);

  if (result === 'timeout' && !isRedisReady()) {
    logger.warn('Redis not ready yet, continuing without it; the client keeps retrying', {
      timeoutMs: connectTimeoutMs,
    });
    return null;
  }
  return isRedisReady() ? client : null;
}

module.exports = { initializeRedis, getRedisClient, isRedisReady, markRedisUnavailable };
