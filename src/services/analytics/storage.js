const { getRedisClient, isRedisReady } = require('../../config/redis');
const { getFirestore } = require('../../config/firebase');
const { logger } = require('../../utils/logger');
const mem = require('./memoryStore');

/**
 * Store metrics in Redis with TTL
 * @param {string} key - Redis key
 * @param {any} value - Value to store
 * @param {number} ttl - Time to live in seconds (default: 7 days)
 */
async function storeMetric(key, value, ttl = 604800) {
  if (!isRedisReady()) {
    logger.debug('Redis not available, skipping metric storage');
    return false;
  }

  try {
    const redis = getRedisClient();
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
    await redis.setEx(key, ttl, serialized);
    return true;
  } catch (error) {
    logger.error('Failed to store metric in Redis', { key, error: error.message });
    return false;
  }
}

/**
 * Increment a counter in Redis
 * @param {string} key - Redis key
 * @param {number} amount - Amount to increment (default: 1)
 */
async function incrementCounter(key, amount = 1) {
  if (!isRedisReady()) {
    return mem.incrementCounter(key, amount);
  }

  try {
    const redis = getRedisClient();
    if (!redis || !redis.incrBy) {
      logger.debug('Redis client not fully initialized');
      return false;
    }
    await redis.incrBy(key, amount);
    return true;
  } catch (error) {
    logger.error('Failed to increment counter', { key, error: error.message });
    return false;
  }
}

/**
 * Get metric from Redis
 * @param {string} key - Redis key
 */
async function getMetric(key) {
  if (!isRedisReady()) {
    return mem.getCounter(key);
  }

  try {
    const redis = getRedisClient();
    const value = await redis.get(key);
    if (!value) return null;

    // Try to parse as JSON, fall back to raw value
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    logger.error('Failed to get metric from Redis', { key, error: error.message });
    return null;
  }
}

/**
 * Store event in Firestore for historical analysis
 * @param {object} event - Event object
 */
async function storeEvent(event) {
  try {
    const db = getFirestore();
    await db.collection('analytics_events').add({
      ...event,
      createdAt: new Date(),
    });
    return true;
  } catch (error) {
    logger.error('Failed to store event in Firestore', { error: error.message });
    return false;
  }
}

/**
 * Store aggregated analytics data
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {object} data - Analytics data
 */
async function storeAggregatedData(date, data) {
  try {
    const db = getFirestore();
    await db.collection('analytics_daily').doc(date).set(
      {
        ...data,
        updatedAt: new Date(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    logger.error('Failed to store aggregated data', { error: error.message });
    return false;
  }
}

/**
 * Add item to a sorted set in Redis (for rankings, leaderboards)
 * @param {string} key - Redis key
 * @param {number} score - Score for sorting
 * @param {string} member - Member to add
 */
async function addToSortedSet(key, score, member) {
  if (!isRedisReady()) {
    return mem.zAdd(key, score, member);
  }

  try {
    const redis = getRedisClient();
    await redis.zAdd(key, { score, value: member });
    return true;
  } catch (error) {
    logger.error('Failed to add to sorted set', { key, error: error.message });
    return false;
  }
}

/**
 * Increment a member's score (a real counter, unlike addToSortedSet which overwrites it)
 */
async function incrementSortedSet(key, member, amount = 1) {
  if (!isRedisReady()) {
    return mem.zIncr(key, member, amount);
  }

  try {
    const redis = getRedisClient();
    await redis.zIncrBy(key, amount, member);
    return true;
  } catch (error) {
    logger.error('Failed to increment sorted set', { key, error: error.message });
    return false;
  }
}

/**
 * Keep only the `keep` highest-scored members so a sorted set cannot grow without bound
 */
async function trimSortedSet(key, keep) {
  if (!isRedisReady()) {
    return mem.zTrim(key, keep);
  }

  try {
    const redis = getRedisClient();
    await redis.zRemRangeByRank(key, 0, -(keep + 1));
    return true;
  } catch (error) {
    logger.error('Failed to trim sorted set', { key, error: error.message });
    return false;
  }
}

/**
 * Get top items from sorted set
 * @param {string} key - Redis key
 * @param {number} limit - Number of items to return
 */
async function getTopFromSortedSet(key, limit = 10) {
  if (!isRedisReady()) {
    return mem.zTop(key, limit);
  }

  try {
    const redis = getRedisClient();
    return await redis.zRange(key, 0, limit - 1, { REV: true, WITHSCORES: true });
  } catch (error) {
    logger.error('Failed to get from sorted set', { key, error: error.message });
    return [];
  }
}

/**
 * Increment hash field
 * @param {string} key - Redis key
 * @param {string} field - Hash field
 * @param {number} amount - Amount to increment
 */
async function incrementHashField(key, field, amount = 1) {
  if (!isRedisReady()) {
    return mem.incrementHashField(key, field, amount);
  }

  try {
    const redis = getRedisClient();
    if (!redis || !redis.hIncrBy) {
      logger.debug('Redis client not fully initialized');
      return false;
    }
    await redis.hIncrBy(key, field, amount);
    return true;
  } catch (error) {
    logger.error('Failed to increment hash field', { key, field, error: error.message });
    return false;
  }
}

/**
 * Get all hash fields
 * @param {string} key - Redis key
 */
async function getHash(key) {
  if (!isRedisReady()) {
    return mem.getHash(key);
  }

  try {
    const redis = getRedisClient();
    return await redis.hGetAll(key);
  } catch (error) {
    logger.error('Failed to get hash', { key, error: error.message });
    return {};
  }
}

/** Add a member to a set (used for unique active users per day). */
async function addToSet(key, member, ttl = 604800) {
  if (!isRedisReady()) return mem.sAdd(key, member);
  try {
    const redis = getRedisClient();
    await redis.sAdd(key, member);
    await redis.expire(key, ttl);
    return true;
  } catch (error) {
    logger.error('Failed to add to set', { key, error: error.message });
    return false;
  }
}

async function getSetSize(key) {
  if (!isRedisReady()) return mem.sCard(key);
  try {
    return await getRedisClient().sCard(key);
  } catch (error) {
    logger.error('Failed to get set size', { key, error: error.message });
    return 0;
  }
}

/** Where the counters currently live. */
const getStorageMode = () => (isRedisReady() ? 'redis' : 'memory');

module.exports = {
  addToSet,
  getSetSize,
  getStorageMode,
  storeMetric,
  incrementCounter,
  getMetric,
  storeEvent,
  storeAggregatedData,
  addToSortedSet,
  incrementSortedSet,
  trimSortedSet,
  getTopFromSortedSet,
  incrementHashField,
  getHash,
};
