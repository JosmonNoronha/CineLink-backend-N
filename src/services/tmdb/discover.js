'use strict';

/**
 * Discover feeds: curated TMDB lists shown from the Home screen's hub menu.
 *
 * Adding a feed = one entry in FEEDS. Each feed says which media types it supports, which TMDB
 * endpoint (and extra params) to use, whether the list depends on the viewer's country, and how long
 * it may be cached. Items come back in the same shape the Home rows and Search use (Title, Year,
 * imdbID "tmdb:movie:123", Poster, ...), so the app can open them in Details unchanged.
 */

const { AppError } = require('../../utils/errors');
const { tmdbGet } = require('./client');
const { cacheGet, cacheSet } = require('./cache');
const { searchByGenreOmdbLike } = require('./compat');

const HOUR = 60 * 60;
const MAX_PAGES = 5; // 100 titles is plenty for a curated list, and keeps TMDB usage small

const FEEDS = {
  'in-theaters': {
    ttl: 6 * HOUR,
    types: {
      movie: { path: '/movie/now_playing', regional: true },
    },
  },
  // Hand-picked by the author in the admin panel (Firestore). Short cache so edits show up within minutes.
  'authors-choice': {
    ttl: 2 * 60,
    types: {
      movie: { custom: true },
      tv: { custom: true },
    },
  },
  // Highest-rated titles of all time (TMDB's top rated, which already requires a healthy vote count).
  // Ranked 1..100 across pages. The list barely changes, so it is cached for a day.
  'top-all-time': {
    ttl: 24 * HOUR,
    ranked: true,
    types: {
      movie: { path: '/movie/top_rated' },
      tv: { path: '/tv/top_rated' },
    },
  },
  // Not released yet. Movies: TMDB's upcoming list for the region. Series: new shows premiering from today on.
  // "Today" is part of the cache key and the TV query, so these are refreshed daily.
  upcoming: {
    ttl: 6 * HOUR,
    daily: true,
    types: {
      movie: { path: '/movie/upcoming', regional: true, futureOnly: true },
      tv: {
        path: '/discover/tv',
        futureOnly: true,
        params: () => ({
          'first_air_date.gte': today(),
          sort_by: 'popularity.desc',
          include_null_first_air_dates: false,
        }),
      },
    },
  },
};

const FEED_IDS = Object.keys(FEEDS);

const today = () => new Date().toISOString().slice(0, 10);

function shortText(s, max) {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

async function getFeed({ feed, type = 'movie', region = 'US', page = 1 }) {
  const def = FEEDS[feed];
  if (!def) throw new AppError('Unknown feed', 404, 'NOT_FOUND');
  const cfg = def.types[type];
  if (!cfg) throw new AppError(`"${feed}" is not available for ${type}`, 400, 'VALIDATION_ERROR');

  const pageNum = Math.min(Math.max(Number(page) || 1, 1), MAX_PAGES);
  const reg = cfg.regional ? String(region || 'US').toUpperCase() : 'ALL';
  const day = def.daily ? today() : '';
  const key = `discover:v1:${feed}:${type}:${reg}:${pageNum}:${day}`;

  const hit = await cacheGet(key);
  if (hit) return hit;

  if (cfg.custom) {
    const items = await require('../discoverPicks').publicItems(type);
    const picked = { feed, type, region: 'ALL', page: 1, totalPages: 1, items };
    await cacheSet(key, picked, def.ttl);
    return picked;
  }

  const raw = await tmdbGet(cfg.path, {
    language: 'en-US',
    page: pageNum,
    ...(cfg.regional ? { region: reg } : {}),
    ...(typeof cfg.params === 'function' ? cfg.params() : cfg.params || {}),
  });

  // Titles without a poster make a broken-looking grid, so leave them out.
  const now = today();
  const PAGE_SIZE = 20; // TMDB list pages; the rank is the position before any poster-less title is dropped
  let results = (raw.results || [])
    .map((r, i) => (r ? { ...r, _rank: (pageNum - 1) * PAGE_SIZE + i + 1 } : r))
    .filter((r) => r && r.id && r.poster_path);
  if (cfg.futureOnly) {
    // already out (or undated) does not belong under "upcoming"; soonest first within the page
    results = results
      .filter((r) => (r.release_date || r.first_air_date || '') >= now)
      .sort((a, b) => (a.release_date || a.first_air_date).localeCompare(b.release_date || b.first_air_date));
  }
  const mapped = await searchByGenreOmdbLike({
    genreResults: { results: results.map((r) => ({ ...r, media_type: type })), totalResults: results.length, page: pageNum },
  });

  const items = (mapped.Search || []).map((item, i) => {
    const r = results[i];
    return {
      ...item,
      _isGenreSearch: undefined,
      releaseDate: r.release_date || r.first_air_date || null,
      overview: shortText(r.overview, 180),
      ...(def.ranked ? { rank: r._rank } : {}),
    };
  });

  const payload = {
    feed,
    type,
    region: reg,
    page: pageNum,
    totalPages: Math.min(Number(raw.total_pages) || 1, MAX_PAGES),
    items,
  };
  await cacheSet(key, payload, def.ttl);
  return payload;
}

// ---------------------------------------------------------------------------------------------
// Release calendar
// ---------------------------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CAL_PAGES = 3; // up to ~60 of the month's most popular titles
const CAL_TTL = 12 * HOUR;
const SHOW_TTL = 6 * HOUR;
const MAX_MY_SHOWS = 40;

function monthRange(month) {
  if (!MONTH_RE.test(String(month))) throw new AppError('Invalid month', 400, 'VALIDATION_ERROR');
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

async function toItems(results, type) {
  const mapped = await searchByGenreOmdbLike({
    genreResults: { results: results.map((r) => ({ ...r, media_type: type })), totalResults: results.length, page: 1 },
  });
  return (mapped.Search || []).map((item, i) => ({
    ...item,
    _isGenreSearch: undefined,
    releaseDate: results[i].release_date || results[i].first_air_date || null,
  }));
}

// Movies (cinema/premiere releases in the region) or series premiering in one month, most popular first.
async function getCalendar({ month, type = 'movie', region = 'US' }) {
  const { from, to } = monthRange(month);
  if (type !== 'movie' && type !== 'tv') throw new AppError('Invalid type', 400, 'VALIDATION_ERROR');
  const reg = type === 'movie' ? String(region || 'US').toUpperCase() : 'ALL';
  const key = `discover:v1:calendar:${type}:${reg}:${month}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const params =
    type === 'movie'
      ? {
          region: reg,
          'release_date.gte': from,
          'release_date.lte': to,
          with_release_type: '2|3',
          sort_by: 'popularity.desc',
          include_adult: false,
        }
      : { 'first_air_date.gte': from, 'first_air_date.lte': to, sort_by: 'popularity.desc' };

  const pages = await Promise.all(
    Array.from({ length: CAL_PAGES }, (_, i) =>
      tmdbGet(`/discover/${type}`, { language: 'en-US', page: i + 1, ...params }).catch((e) => {
        if (i === 0) throw e; // page 1 failing is a real failure; later pages are a bonus
        return { results: [] };
      })
    )
  );
  const seen = new Set();
  const results = pages
    .flatMap((p) => p.results || [])
    .filter((r) => r && r.id && r.poster_path && (r.release_date || r.first_air_date) && !seen.has(r.id) && seen.add(r.id));
  const payload = { month, type, region: reg, items: await toItems(results, type) };
  await cacheSet(key, payload, CAL_TTL);
  return payload;
}

async function showAirDates(id) {
  const key = `discover:v1:tvair:${id}`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const d = await tmdbGet(`/tv/${id}`, { language: 'en-US' });
  const ep = (e) =>
    e && e.air_date
      ? { date: e.air_date, season: e.season_number, episode: e.episode_number, name: e.name || null }
      : null;
  const out = { id: d.id, name: d.name, poster_path: d.poster_path, eps: [ep(d.last_episode_to_air), ep(d.next_episode_to_air)].filter(Boolean) };
  await cacheSet(key, out, SHOW_TTL);
  return out;
}

// Episodes airing in a month for the user's own shows (their last aired and next scheduled episode).
async function getMyShowsCalendar({ month, ids }) {
  const { from, to } = monthRange(month);
  const unique = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_MY_SHOWS);
  const shows = [];
  for (let i = 0; i < unique.length; i += 5) {
    const chunk = await Promise.all(unique.slice(i, i + 5).map((id) => showAirDates(id).catch(() => null)));
    shows.push(...chunk.filter(Boolean));
  }
  const rows = [];
  for (const sh of shows) {
    for (const e of sh.eps) {
      if (e.date >= from && e.date <= to) rows.push({ sh, e });
    }
  }
  const base = await toItems(
    rows.map(({ sh, e }) => ({ id: sh.id, name: sh.name, poster_path: sh.poster_path, first_air_date: e.date })),
    'tv'
  );
  const items = base
    .map((item, i) => ({ ...item, episodeLabel: `S${rows[i].e.season}E${rows[i].e.episode}`, episodeName: rows[i].e.name }))
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return { month, type: 'my-shows', items };
}

module.exports = { getFeed, getCalendar, getMyShowsCalendar, FEEDS, FEED_IDS, MAX_PAGES, MAX_MY_SHOWS };
