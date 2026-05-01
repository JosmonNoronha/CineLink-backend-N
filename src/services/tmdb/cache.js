const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const { getRedisClient, isRedisReady, markRedisUnavailable } = require('../../config/redis');
const { logger } = require('../../utils/logger');
const { cacheHitRate, cacheMissRate } = require('../../routes/metrics');
// const { recordCacheHit, recordCacheMiss } = require('../grafanaCloudOtlp');

const MAX_MEMORY_ITEMS = 500;
const MAX_MEMORY_BYTES = 50 * 1024 * 1024;

const memory = new LRUCache({
  max: MAX_MEMORY_ITEMS,
  maxSize: MAX_MEMORY_BYTES,
  ttl: 60 * 60 * 1000,
  updateAgeOnGet: true,
  allowStale: false,
  sizeCalculation: (value) => {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch (_error) {
      return 1;
    }
  },
});

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
          cacheHitRate.inc({ cache_type: 'redis' });
          // recordCacheHit('redis');
          return JSON.parse(val);
        }
        cacheMissRate.inc({ cache_type: 'redis' });
        // recordCacheMiss('redis');
        return null;
      }
    } catch (err) {
      logger.warn('Redis get failed, cache miss', { key, err: err.message });
      markRedisUnavailable();
    }
  }

  const entry = memory.get(h);
  if (entry) {
    cacheHitRate.inc({ cache_type: 'memory' });
    // recordCacheHit('memory');
  } else {
    cacheMissRate.inc({ cache_type: 'memory' });
    // recordCacheMiss('memory');
  }
  return entry ?? null;
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

  memory.set(h, value, { ttl: ttlSeconds * 1000 });
}

function getCacheStats() {
  return {
    size: memory.size,
    maxSize: MAX_MEMORY_ITEMS,
    calculatedSize: memory.calculatedSize,
    maxCalculatedSize: MAX_MEMORY_BYTES,
  };
}

module.exports = { cacheGet, cacheSet, getCacheStats };
