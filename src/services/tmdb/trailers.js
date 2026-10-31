'use strict';

const { cacheGet, cacheSet } = require('./cache');
const trendingService = require('./trending');
const moviesService = require('./movies');
const tvService = require('./tv');
const { logger } = require('../../utils/logger');

const CACHE_KEY = 'trailers:latest:v1';
const CACHE_TTL_SECONDS = 3 * 60 * 60;
const TRENDING_POOL = 14;
const UPCOMING_POOL = 8;
const CONCURRENCY = 5;

/** Best YouTube trailer of a title: official first, then newest. Teasers/clips never count. */
function pickTrailer(videos) {
  const list = (Array.isArray(videos) ? videos : []).filter(
    (v) => v && v.site === 'YouTube' && v.type === 'Trailer' && v.key
  );
  if (!list.length) return null;
  list.sort((a, b) => {
    if (Boolean(b.official) !== Boolean(a.official)) return b.official ? 1 : -1;
    return String(b.published_at || '').localeCompare(String(a.published_at || ''));
  });
  const v = list[0];
  return { key: v.key, name: v.name || '', publishedAt: v.published_at || null };
}

const identity = (item) => `${item.media_type}:${item.id}`;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  }
  return out;
}

async function buildLatestTrailers(limit) {
  const [trendingRes, upcomingRes] = await Promise.allSettled([
    trendingService.trending('all', 'week'),
    moviesService.listUpcoming(1),
  ]);

  const candidates = new Map();
  const add = (item, mediaType, upcoming) => {
    if (!item?.id) return;
    const entry = { ...item, media_type: mediaType, upcoming };
    if (!candidates.has(identity(entry))) candidates.set(identity(entry), entry);
  };
  if (trendingRes.status === 'fulfilled') {
    (trendingRes.value.data?.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, TRENDING_POOL)
      .forEach((r) => add(r, r.media_type, false));
  }
  if (upcomingRes.status === 'fulfilled') {
    (upcomingRes.value.data?.results || []).slice(0, UPCOMING_POOL).forEach((r) => add(r, 'movie', true));
  }
  if (!candidates.size) return null; // nothing to work with: do not cache an empty answer

  const settled = await inBatches([...candidates.values()], CONCURRENCY, async (c) => {
    const res = c.media_type === 'tv' ? await tvService.videos(c.id) : await moviesService.videos(c.id);
    const trailer = pickTrailer(res.data?.results);
    if (!trailer) return null;
    return {
      id: c.id,
      mediaType: c.media_type,
      title: c.title || c.name || '',
      overview: c.overview || '',
      posterPath: c.poster_path || null,
      backdropPath: c.backdrop_path || null,
      releaseDate: c.release_date || c.first_air_date || null,
      voteAverage: typeof c.vote_average === 'number' ? c.vote_average : null,
      upcoming: Boolean(c.upcoming),
      trailer,
    };
  });

  const failed = settled.filter((s) => s.status === 'rejected').length;
  if (failed) logger.warn({ message: 'trailers: some video lookups failed', failed });

  return settled
    .filter((s) => s.status === 'fulfilled' && s.value)
    .map((s) => s.value)
    .sort((a, b) => String(b.trailer.publishedAt || '').localeCompare(String(a.trailer.publishedAt || '')))
    .slice(0, limit);
}

/** Newest trailers among what is trending now and what is coming soon. */
async function latestTrailers({ limit = 12 } = {}) {
  const hit = await cacheGet(CACHE_KEY);
  if (hit) return { data: hit.slice(0, limit), source: 'cache' };
  const built = await buildLatestTrailers(20); // cache a fixed pool, slice per request
  if (!built) return { data: [], source: 'tmdb' };
  if (built.length) await cacheSet(CACHE_KEY, built, CACHE_TTL_SECONDS);
  return { data: built.slice(0, limit), source: 'tmdb' };
}

module.exports = { latestTrailers, pickTrailer };
