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

async function multi(query, page = 1) {
  return cached('/search/multi', { query, page }, 60 * 60);
}

async function movie(query, page = 1) {
  return cached('/search/movie', { query, page }, 60 * 60);
}

async function tv(query, page = 1) {
  return cached('/search/tv', { query, page }, 60 * 60);
}

async function person(query, page = 1) {
  return cached('/search/person', { query, page }, 60 * 60);
}

module.exports = { multi, movie, tv, person };
