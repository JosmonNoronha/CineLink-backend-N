const crypto = require('crypto');
const { getRedisClient } = require('../../config/redis');

const memory = new Map();

function hashKey(key) {
  return crypto.createHash('sha1').update(key).digest('hex');
}

async function cacheGet(key) {
  const redis = await getRedisClient();
  const h = hashKey(key);

  if (redis) {
    const val = await redis.get(h);
    return val ? JSON.parse(val) : null;
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
  const redis = await getRedisClient();
  const h = hashKey(key);
  const payload = JSON.stringify(value);

  if (redis) {
    await redis.set(h, payload, { EX: ttlSeconds });
    return;
  }

  memory.set(h, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

module.exports = { cacheGet, cacheSet };
