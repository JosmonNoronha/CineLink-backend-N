const axios = require('axios');
const dns = require('dns');
const { tmdbConfig } = require('../../config/tmdb');
const { AppError } = require('../../utils/errors');
const { logger } = require('../../utils/logger');

// Force IPv4 resolution to avoid IPv6 routing issues
dns.setDefaultResultOrder('ipv4first');

const tmdb = axios.create({
  baseURL: tmdbConfig.baseUrl,
  timeout: 30_000, // Increased from 10s to 30s for slower networks
  // Removed family: 4 as it may cause issues with axios.create
});

async function tmdbGet(path, params = {}) {
  const startTime = Date.now();
  try {
    logger.info(`TMDB Request: ${path}`, { params: Object.keys(params) });
    const res = await tmdb.get(path, {
      params: {
        ...params,
        api_key: tmdbConfig.apiKey,
      },
    });
    logger.info(`TMDB Response: ${path} (${Date.now() - startTime}ms)`);
    return res.data;
  } catch (err) {
    logger.error(`TMDB Error: ${path} (${Date.now() - startTime}ms)`, {
      error: err.message,
      code: err.code,
      status: err.response?.status,
    });
    const status = err.response?.status || 502;
    const message = err.response?.data?.status_message || err.message || 'TMDB request failed';
    throw new AppError(message, status >= 400 && status < 600 ? status : 502, 'TMDB_ERROR');
  }
}

module.exports = { tmdbGet };
