const { cacheGet, cacheSet } = require('./cache');
const { tmdbGet } = require('./client');
const { AppError } = require('../../utils/errors');

async function cached(path, params, ttlSeconds) {
  const key = `tmdb:${path}:${JSON.stringify(params || {})}`;
  const hit = await cacheGet(key);
  if (hit) return { data: hit, source: 'cache' };
  const data = await tmdbGet(path, params);
  await cacheSet(key, data, ttlSeconds);
  return { data, source: 'tmdb' };
}

async function getRecommendations({ media_type, tmdb_id, page = 1 }) {
  if (media_type !== 'movie' && media_type !== 'tv') {
    throw new AppError('media_type must be movie or tv', 400, 'VALIDATION_ERROR');
  }
  const path =
    media_type === 'movie' ? `/movie/${tmdb_id}/recommendations` : `/tv/${tmdb_id}/recommendations`;
  return cached(path, { page }, 6 * 60 * 60);
}

module.exports = { getRecommendations };
