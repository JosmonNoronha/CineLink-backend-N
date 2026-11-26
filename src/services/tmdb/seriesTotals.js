'use strict';

const axios = require('axios');

/**
 * Episode totals for a TMDB series, from one request to /tv/{id}:
 *   { totalSeasons, totalEpisodes, seasonCounts: { "1": 10, "2": 8 } }
 *
 * Only episodes that have already aired are counted, so a show that is still running can be
 * "finished" today and does not stay at 99% because a future episode is announced.
 * Season 0 (specials) is ignored. Results are cached in memory for a few hours.
 * The API key is never put in an error message or log.
 */
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE = 500;

function totalsFromTmdb(info) {
  if (!info || !Array.isArray(info.seasons)) return null;
  const next = info.next_episode_to_air || null;
  const seasonCounts = {};
  let totalEpisodes = 0;

  for (const s of info.seasons) {
    const n = Number(s.season_number);
    let count = Number(s.episode_count) || 0;
    if (!Number.isInteger(n) || n < 1) continue;
    if (next) {
      const ns = Number(next.season_number);
      if (n > ns) continue; // a season that has not started
      if (n === ns) count = Math.max(0, Number(next.episode_number) - 1); // only what has aired
    }
    if (count < 1) continue;
    seasonCounts[String(n)] = count;
    totalEpisodes += count;
  }
  const totalSeasons = Object.keys(seasonCounts).length;
  if (!totalSeasons) return null;
  return { totalSeasons, totalEpisodes, seasonCounts };
}

function createSeriesTotals({ apiKey = process.env.TMDB_API_KEY, http = axios, base = 'https://api.themoviedb.org/3', now = Date.now } = {}) {
  const cache = new Map(); // tmdbId -> { at, value }
  const inflight = new Map();

  async function fetchTotals(tmdbId) {
    if (!apiKey) return null;
    const bearer = /^ey/.test(apiKey) || apiKey.length > 40;
    try {
      const res = await http.get(`${base}/tv/${encodeURIComponent(tmdbId)}`, {
        params: bearer ? { language: 'en-US' } : { api_key: apiKey, language: 'en-US' },
        headers: bearer ? { Authorization: `Bearer ${apiKey}` } : undefined,
        timeout: 8000,
      });
      return totalsFromTmdb(res.data);
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw new Error(`TMDB request failed (${err.response?.status || err.code || 'network'})`);
    }
  }

  /** Returns totals, or null when unknown (no key, not found, TMDB down). Never throws. */
  async function get(tmdbId) {
    const id = String(tmdbId || '');
    if (!/^\d+$/.test(id)) return null;
    const hit = cache.get(id);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    if (inflight.has(id)) return inflight.get(id);

    const p = fetchTotals(id)
      .then((value) => {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        cache.set(id, { at: now(), value });
        return value;
      })
      .catch(() => null)
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  return { get };
}

module.exports = { createSeriesTotals, totalsFromTmdb };
