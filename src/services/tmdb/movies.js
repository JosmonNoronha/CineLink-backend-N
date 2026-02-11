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

async function listPopular(page = 1) {
  return cached('/movie/popular', { page }, 6 * 60 * 60);
}

async function listTopRated(page = 1) {
  return cached('/movie/top_rated', { page }, 6 * 60 * 60);
}

async function listNowPlaying(page = 1) {
  return cached('/movie/now_playing', { page }, 6 * 60 * 60);
}

async function listUpcoming(page = 1) {
  return cached('/movie/upcoming', { page }, 6 * 60 * 60);
}

async function details(id) {
  return cached(`/movie/${id}`, {}, 24 * 60 * 60);
}

async function credits(id) {
  return cached(`/movie/${id}/credits`, {}, 24 * 60 * 60);
}

async function videos(id) {
  return cached(`/movie/${id}/videos`, {}, 24 * 60 * 60);
}

async function images(id) {
  return cached(`/movie/${id}/images`, {}, 24 * 60 * 60);
}

async function recommendations(id, page = 1) {
  return cached(`/movie/${id}/recommendations`, { page }, 6 * 60 * 60);
}

async function watchProviders(id) {
  return cached(`/movie/${id}/watch/providers`, {}, 24 * 60 * 60);
}

module.exports = {
  listPopular,
  listTopRated,
  listNowPlaying,
  listUpcoming,
  details,
  credits,
  videos,
  images,
  recommendations,
  watchProviders,
};
