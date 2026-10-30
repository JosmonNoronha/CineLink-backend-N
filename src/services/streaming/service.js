'use strict';

const { pickFor } = require('./matcher');
const { getShow, listShows: listConfiguredShows } = require('./shows');
const { AppError } = require('../../utils/errors');

const CACHE_TTL_MS = 10 * 60 * 1000;
const COUNTRY = /^[A-Za-z]{2}$/;

/** Read side: what can this viewer watch? Keeps the catalog in memory for 10 minutes. */
function createStreamingService({ catalog, now = () => Date.now() }) {
  const cache = new Map(); // tmdbId -> { at, episodes, blocked, meta }

  async function load(tmdbId) {
    const hit = cache.get(tmdbId);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit;
    const [episodes, meta] = await Promise.all([catalog.loadEpisodes(tmdbId), catalog.loadMeta(tmdbId)]);
    const fresh = { at: now(), episodes, meta, blocked: new Set(meta.blockedVideos || []) };
    cache.set(tmdbId, fresh);
    return fresh;
  }

  const invalidate = (tmdbId) => cache.delete(Number(tmdbId));

  function normaliseCountry(country) {
    return COUNTRY.test(String(country || '')) ? String(country).toUpperCase() : null;
  }

  /** Compact list for the app: [[episode, videoId, fallbackVideoId|0], ...] */
  async function availability(tmdbId, country) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('No free streaming for this title', 404, 'STREAMING_NOT_FOUND');
    const region = normaliseCountry(country);
    const { episodes, blocked, meta } = await load(show.tmdbId);
    const rows = [];
    for (const [n, sources] of episodes) {
      const pick = pickFor(sources, region || 'ZZ', blocked);
      if (pick) rows.push([n, pick.primary.v, pick.alt ? pick.alt.v : 0]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return {
      tmdbId: show.tmdbId,
      title: show.title,
      region,
      count: rows.length,
      latest: rows.length ? rows[rows.length - 1][0] : null,
      updatedAt: meta.lastSync?.at || null,
      episodes: rows,
    };
  }

  /** Shows that have at least one episode this viewer can watch. */
  async function listShows(country) {
    const out = [];
    for (const show of listConfiguredShows()) {
      const a = await availability(show.tmdbId, country);
      if (a.count > 0)
        out.push({
          tmdbId: show.tmdbId,
          title: show.title,
          season: show.season,
          count: a.count,
          latest: a.latest,
          updatedAt: a.updatedAt,
        });
    }
    return out;
  }

  async function episode(tmdbId, n, country) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('No free streaming for this title', 404, 'STREAMING_NOT_FOUND');
    const { episodes, blocked } = await load(show.tmdbId);
    const pick = pickFor(episodes.get(Number(n)), normaliseCountry(country) || 'ZZ', blocked);
    if (!pick)
      throw new AppError('This episode is not available to watch here', 404, 'EPISODE_NOT_AVAILABLE');
    return { episode: Number(n), videoId: pick.primary.v, fallbackVideoId: pick.alt ? pick.alt.v : null };
  }

  /** For admins: how complete is it, and where are the holes. */
  async function report(tmdbId, totalEpisodes) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('Unknown show', 404, 'STREAMING_NOT_FOUND');
    const { episodes, meta } = await load(show.tmdbId);
    const total = Number(totalEpisodes) || Math.max(0, ...episodes.keys());
    const holes = [];
    for (let n = 1; n <= total; n += 1) {
      if (!(episodes.get(n) || []).length) {
        const last = holes[holes.length - 1];
        if (last && n === last[1] + 1) last[1] = n;
        else holes.push([n, n]);
      }
    }
    return {
      tmdbId: show.tmdbId,
      episodesWithVideo: episodes.size,
      totalChecked: total,
      biggestHoles: holes
        .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
        .slice(0, 15)
        .map(([a, b]) => `${a}-${b} (${b - a + 1})`),
      blockedVideos: meta.blockedVideos || [],
      lastSync: meta.lastSync || null,
    };
  }

  async function setBlocked(tmdbId, videoId, blockedNow) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('Unknown show', 404, 'STREAMING_NOT_FOUND');
    const meta = await catalog.loadMeta(show.tmdbId);
    const set = new Set(meta.blockedVideos || []);
    if (blockedNow) set.add(videoId);
    else set.delete(videoId);
    await catalog.saveMeta(show.tmdbId, { blockedVideos: [...set].slice(0, 500) });
    invalidate(show.tmdbId);
    return { blockedVideos: [...set] };
  }

  return { availability, listShows, episode, report, setBlocked, invalidate };
}

module.exports = { createStreamingService };
