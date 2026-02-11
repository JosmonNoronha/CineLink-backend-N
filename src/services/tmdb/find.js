const { tmdbGet } = require('./client');
const { cacheGet, cacheSet } = require('./cache');

async function resolveByImdbId(imdbId) {
  const key = `tmdb:/find:${imdbId}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const data = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' });
  await cacheSet(key, data, 24 * 60 * 60);
  return data;
}

async function movieExternalIds(tmdbId) {
  const key = `tmdb:/movie/${tmdbId}/external_ids`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const data = await tmdbGet(`/movie/${tmdbId}/external_ids`);
  await cacheSet(key, data, 24 * 60 * 60);
  return data;
}

async function tvExternalIds(tmdbId) {
  const key = `tmdb:/tv/${tmdbId}/external_ids`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const data = await tmdbGet(`/tv/${tmdbId}/external_ids`);
  await cacheSet(key, data, 24 * 60 * 60);
  return data;
}

module.exports = { resolveByImdbId, movieExternalIds, tvExternalIds };
