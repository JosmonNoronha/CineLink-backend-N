'use strict';

const { pickFor } = require('./matcher');
const { getShow, listShows: listConfiguredShows } = require('./shows');
const { isMultiSeason, encode, decode, resolveSeason } = require('./seasons');
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

  /** Playable rows for one viewer, grouped by season: Map<season, [[episode, videoId, fallbackVideoId|0], ...]> */
  function rowsBySeason(show, episodes, blocked, region) {
    const bySeason = new Map();
    for (const [key, sources] of episodes) {
      const pick = pickFor(sources, region || 'ZZ', blocked);
      if (!pick) continue;
      const { season, episode } = decode(show, key);
      if (!bySeason.has(season)) bySeason.set(season, []);
      bySeason.get(season).push([episode, pick.primary.v, pick.alt ? pick.alt.v : 0]);
    }
    for (const rows of bySeason.values()) rows.sort((x, y) => x[0] - y[0]);
    return bySeason;
  }

  /** Compact list for the app: [[episode, videoId, fallbackVideoId|0], ...] for one season. */
  async function availability(tmdbId, country, season) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('No free streaming for this title', 404, 'STREAMING_NOT_FOUND');
    const region = normaliseCountry(country);
    const wanted = resolveSeason(show, season);
    const { episodes, blocked, meta } = await load(show.tmdbId);
    const bySeason = rowsBySeason(show, episodes, blocked, region);
    const rows = bySeason.get(wanted) || [];
    return {
      tmdbId: show.tmdbId,
      title: show.title,
      season: wanted,
      // Every season this viewer can watch. A multi-season show carries each season's episodes right here,
      // so the app loads the whole show in one request and switching seasons needs no further call.
      // (A single-season show keeps the compact shape: its episodes are the top-level list below.)
      seasons: [...bySeason.keys()]
        .sort((a, b) => a - b)
        .map((n) => {
          const list = bySeason.get(n);
          return {
            season: n,
            count: list.length,
            latest: list[list.length - 1][0],
            ...(isMultiSeason(show) ? { episodes: list } : {}),
          };
        }),
      region,
      count: rows.length,
      latest: rows.length ? rows[rows.length - 1][0] : null,
      updatedAt: meta.lastSync?.at || null,
      episodes: rows,
    };
  }

  /**
   * One entry per show this viewer can watch anything of. `season` is the first season available;
   * a show with several seasons also reports `seasonCount`, its `count` covers all of them, and
   * `latest` is left null because "newest episode" has no single meaning across seasons.
   */
  async function listShows(country) {
    const region = normaliseCountry(country);
    const out = [];
    for (const show of listConfiguredShows()) {
      const { episodes, blocked, meta } = await load(show.tmdbId);
      const bySeason = rowsBySeason(show, episodes, blocked, region);
      const seasonNumbers = [...bySeason.keys()].sort((x, y) => x - y);
      if (!seasonNumbers.length) continue;
      const first = bySeason.get(seasonNumbers[0]);
      const several = seasonNumbers.length > 1;
      out.push({
        tmdbId: show.tmdbId,
        title: show.title,
        season: seasonNumbers[0],
        ...(several ? { seasonCount: seasonNumbers.length } : {}),
        count: seasonNumbers.reduce((sum, n) => sum + bySeason.get(n).length, 0),
        latest: several ? null : first[first.length - 1][0],
        updatedAt: meta.lastSync?.at || null,
      });
    }
    return out;
  }

  async function episode(tmdbId, n, country, season) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('No free streaming for this title', 404, 'STREAMING_NOT_FOUND');
    const { episodes, blocked } = await load(show.tmdbId);
    const key = encode(show, resolveSeason(show, season), Number(n));
    const pick = pickFor(episodes.get(key), normaliseCountry(country) || 'ZZ', blocked);
    if (!pick)
      throw new AppError('This episode is not available to watch here', 404, 'EPISODE_NOT_AVAILABLE');
    return { episode: Number(n), videoId: pick.primary.v, fallbackVideoId: pick.alt ? pick.alt.v : null };
  }

  /** For admins: how complete is it, and where are the holes (one season at a time). */
  async function report(tmdbId, totalEpisodes, season) {
    const show = getShow(tmdbId);
    if (!show) throw new AppError('Unknown show', 404, 'STREAMING_NOT_FOUND');
    const { episodes, meta } = await load(show.tmdbId);
    const wanted = resolveSeason(show, season);
    const mine = new Map(); // episode number -> sources, for this season
    const seasons = {};
    for (const [key, list] of episodes) {
      const d = decode(show, key);
      const info = seasons[d.season] || (seasons[d.season] = { episodesWithVideo: 0, latest: 0 });
      info.episodesWithVideo += 1;
      info.latest = Math.max(info.latest, d.episode);
      if (d.season === wanted) mine.set(d.episode, list);
    }
    const total = Number(totalEpisodes) || Math.max(0, ...mine.keys());
    const holes = [];
    for (let n = 1; n <= total; n += 1) {
      if (!(mine.get(n) || []).length) {
        const last = holes[holes.length - 1];
        if (last && n === last[1] + 1) last[1] = n;
        else holes.push([n, n]);
      }
    }
    return {
      tmdbId: show.tmdbId,
      season: wanted,
      episodesWithVideo: mine.size,
      totalChecked: total,
      biggestHoles: holes
        .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
        .slice(0, 15)
        .map(([a, b]) => `${a}-${b} (${b - a + 1})`),
      ...(isMultiSeason(show) ? { seasons } : {}),
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
