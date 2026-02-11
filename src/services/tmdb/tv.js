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
  return cached('/tv/popular', { page }, 6 * 60 * 60);
}

async function listTopRated(page = 1) {
  return cached('/tv/top_rated', { page }, 6 * 60 * 60);
}

async function listAiringToday(page = 1) {
  return cached('/tv/airing_today', { page }, 6 * 60 * 60);
}

async function listOnTheAir(page = 1) {
  return cached('/tv/on_the_air', { page }, 6 * 60 * 60);
}

async function details(id) {
  return cached(`/tv/${id}`, {}, 24 * 60 * 60);
}

async function season(id, season_number) {
  return cached(`/tv/${id}/season/${season_number}`, {}, 24 * 60 * 60);
}

async function episode(id, season_number, episode_number) {
  return cached(`/tv/${id}/season/${season_number}/episode/${episode_number}`, {}, 24 * 60 * 60);
}

async function credits(id) {
  return cached(`/tv/${id}/credits`, {}, 24 * 60 * 60);
}

async function videos(id) {
  return cached(`/tv/${id}/videos`, {}, 24 * 60 * 60);
}

async function seasonVideos(id, season_number) {
  return cached(`/tv/${id}/season/${season_number}/videos`, {}, 24 * 60 * 60);
}

async function images(id) {
  return cached(`/tv/${id}/images`, {}, 24 * 60 * 60);
}

async function recommendations(id, page = 1) {
  return cached(`/tv/${id}/recommendations`, { page }, 6 * 60 * 60);
}

async function watchProviders(id) {
  return cached(`/tv/${id}/watch/providers`, {}, 24 * 60 * 60);
}

module.exports = {
  listPopular,
  listTopRated,
  listAiringToday,
  listOnTheAir,
  details,
  season,
  episode,
  credits,
  videos,
  seasonVideos,
  images,
  recommendations,
  watchProviders,
};
