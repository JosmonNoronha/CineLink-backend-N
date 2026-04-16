const crypto = require('crypto');
const { getRedisClient, isRedisReady, markRedisUnavailable } = require('../../config/redis');
const { logger } = require('../../utils/logger');

const memory = new Map();

function hashKey(key) {
  return crypto.createHash('sha1').update(key).digest('hex');
}

async function cacheGet(key) {
  const h = hashKey(key);

  if (isRedisReady()) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        const val = await redis.get(h);
        if (val !== null && val !== undefined) {
          return JSON.parse(val);
        }
        return null;
      }
    } catch (err) {
      logger.warn('Redis get failed, cache miss', { key, err: err.message });
      markRedisUnavailable();
    }
  }

  const entry = memory.get(h);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memory.delete(h);
    return null;
  }
  return entry.value;
}

async function cacheSet(key, value, ttlSeconds) {
  const h = hashKey(key);
  const payload = JSON.stringify(value);

  if (isRedisReady()) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.set(h, payload, { EX: ttlSeconds });
        return;
      }
    } catch (err) {
      logger.warn('Redis set failed, skipping cache write', { key, err: err.message });
      markRedisUnavailable();
    }
  }

  memory.set(h, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

module.exports = { cacheGet, cacheSet };
