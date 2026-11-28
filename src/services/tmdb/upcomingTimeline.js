'use strict';

/**
 * Upcoming timeline: movies (for the viewer's region) and new series, merged into ONE list
 * sorted by release date. The app groups it under "This week", "Next week", months, ...
 * No paging: a few TMDB pages per kind are fetched together and cached, so the date headings are
 * always in order.
 */

const { tmdbGet } = require('./client');
const { cacheGet, cacheSet } = require('./cache');
const { searchByGenreOmdbLike } = require('./compat');

const HOUR = 60 * 60;
const PAGES = 3; // ~60 movies + ~60 series
const TTL = 6 * HOUR;
const HORIZON_DAYS = 180; // series premieres further out than this are mostly placeholders
const MAX_ITEMS = 150;

const isoDay = (d) => d.toISOString().slice(0, 10);
const today = () => isoDay(new Date());

function shortText(s, max) {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Page 1 failing is a real failure; later pages are a bonus.
function fetchPages(path, params) {
  return Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      tmdbGet(path, { language: 'en-US', page: i + 1, ...params }).catch((e) => {
        if (i === 0) throw e;
        return { results: [] };
      })
    )
  );
}

async function getUpcomingTimeline({ region = 'US' } = {}) {
  const reg = String(region || 'US').toUpperCase();
  const now = today();
  const key = `discover:v1:upcoming-timeline:${reg}:${now}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const horizon = isoDay(new Date(Date.now() + HORIZON_DAYS * 864e5));
  const [movies, shows] = await Promise.all([
    fetchPages('/movie/upcoming', { region: reg }),
    fetchPages('/discover/tv', {
      'first_air_date.gte': now,
      'first_air_date.lte': horizon,
      sort_by: 'popularity.desc',
      include_null_first_air_dates: false,
    }),
  ]);

  const seen = new Set();
  const rows = [
    ...movies.flatMap((p) => p.results || []).map((r) => ({ ...r, media_type: 'movie' })),
    ...shows.flatMap((p) => p.results || []).map((r) => ({ ...r, media_type: 'tv' })),
  ]
    .filter((r) => r && r.id && r.poster_path)
    .filter((r) => (r.release_date || r.first_air_date || '') >= now)
    .filter((r) => {
      const k = `${r.media_type}:${r.id}`;
      return !seen.has(k) && seen.add(k);
    })
    .sort(
      (a, b) =>
        (a.release_date || a.first_air_date).localeCompare(b.release_date || b.first_air_date) ||
        (b.popularity || 0) - (a.popularity || 0)
    )
    .slice(0, MAX_ITEMS);

  const mapped = await searchByGenreOmdbLike({
    genreResults: { results: rows, totalResults: rows.length, page: 1 },
  });
  const items = (mapped.Search || []).map((item, i) => ({
    ...item,
    _isGenreSearch: undefined,
    releaseDate: rows[i].release_date || rows[i].first_air_date,
    overview: shortText(rows[i].overview, 180),
  }));

  const payload = { region: reg, items };
  await cacheSet(key, payload, TTL);
  return payload;
}

module.exports = { getUpcomingTimeline, HORIZON_DAYS, MAX_ITEMS };
