// src/services/search/typeahead.js  (NEW FILE)
'use strict';

const { searchOmdbLike } = require('../tmdb/compat');
const { foldText, rankTitles } = require('./rank');

// Tiny in-memory LRU + in-flight dedupe. Per server instance, cleared on
// restart. That's fine for typeahead: results are cheap to rebuild.
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map();
const inflight = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key); // re-insert → most recently used
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

// Thumbnails render at ~38x56, so w154 is plenty (w500 is ~10x the bytes).
const thumb = (url) => (url && url !== 'N/A' ? url.replace('/w500', '/w154') : null);

async function typeahead({ q, limit = 6 }) {
  const query = String(q || '').trim().replace(/\s+/g, ' ');
  if (query.length < 2) return { suggestions: [] };

  const size = Math.min(Math.max(Number(limit) || 6, 1), 10);
  const key = `${foldText(query)}|${size}`;

  const cached = cacheGet(key);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    // Titles only: no person lookup, no analytics tracking.
    const data = await searchOmdbLike({ q: query, type: 'all', page: 1 });

    const suggestions = rankTitles(data.Search, query)
      // Drop junk entries that have neither a year nor a poster
      .filter((r) => r.Year !== 'N/A' || (r.Poster && r.Poster !== 'N/A'))
      .slice(0, size)
      .map((r) => ({
        imdbID: r.imdbID,
        title: r.Title,
        year: r.Year === 'N/A' ? null : r.Year,
        type: r.Type, // 'movie' | 'series'
        poster: thumb(r.Poster),
      }));

    const value = { suggestions };
    cacheSet(key, value);
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

module.exports = { typeahead };