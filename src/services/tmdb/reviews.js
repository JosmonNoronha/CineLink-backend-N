const { tmdbGet } = require('./client');
const { cacheGet, cacheSet } = require('./cache');

async function cached(path, params, ttlSeconds) {
  const key = `tmdb:${path}:${JSON.stringify(params || {})}`;
  const hit = await cacheGet(key);
  if (hit) return { data: hit, source: 'cache' };
  const data = await tmdbGet(path, params);
  await cacheSet(key, data, ttlSeconds);
  return { data, source: 'tmdb' };
}

/**
 * Get reviews for a movie
 * @param {number} id - TMDB movie ID
 * @param {number} page - Page number (default: 1)
 * @returns {Promise<Object>} Reviews data with pagination
 */
async function getMovieReviews(id, page = 1) {
  return cached(`/movie/${id}/reviews`, { page }, 12 * 60 * 60); // Cache 12 hours
}

/**
 * Get reviews for a TV show
 * @param {number} id - TMDB TV show ID
 * @param {number} page - Page number (default: 1)
 * @returns {Promise<Object>} Reviews data with pagination
 */
async function getTVReviews(id, page = 1) {
  return cached(`/tv/${id}/reviews`, { page }, 12 * 60 * 60); // Cache 12 hours
}

module.exports = {
  getMovieReviews,
  getTVReviews,
};
