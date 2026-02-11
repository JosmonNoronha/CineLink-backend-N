const { createClient } = require('redis');
const { env } = require('./environment');
const { logger } = require('../utils/logger');

let redisClient;
let redisReady = false;

async function initializeRedis() {
  if (!env.REDIS_URL) {
    logger.info('Redis URL not configured, skipping Redis initialization');
    return null;
  }
  
  if (redisClient) return redisClient;

  try {
    redisClient = createClient({ url: env.REDIS_URL });
    
    redisClient.on('error', (err) => {
      redisReady = false;
      logger.warn(`Redis error: ${err.message}`);
    });
    
    redisClient.on('ready', () => {
      redisReady = true;
      logger.info('Redis ready');
    });

    redisClient.on('connect', () => {
      logger.info('Redis connecting...');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis', { error: error.message });
    redisClient = null;
    redisReady = false;
    return null;
  }
}

function getRedisClient() {
  return redisClient;
}

function isRedisReady() {
  return !!redisClient && redisClient.isOpen && redisReady;
}

module.exports = { initializeRedis, getRedisClient, isRedisReady };
