'use strict';

const axios = require('axios');

const GENERIC = new Set(['the', 'it', 'up', 'us', 'her', 'him', 'you', 'them', 'old', 'bad', 'now', 'one', 'two']);

/** Titles and people trending on TMDB, as search terms. The key is never printed or put in errors. */
function createTrendTerms({ apiKey, http = axios, base = 'https://api.themoviedb.org/3' } = {}) {
  const bearer = /^ey/.test(apiKey || '') || (apiKey || '').length > 40;
  const get = async (path) => {
    try {
      const res = await http.get(`${base}${path}`, {
        params: bearer ? { language: 'en-US' } : { api_key: apiKey, language: 'en-US' },
        headers: bearer ? { Authorization: `Bearer ${apiKey}` } : undefined,
        timeout: 12000,
      });
      return res.data?.results || [];
    } catch (err) {
      throw new Error(`TMDB request failed (${err.response?.status || err.code || 'network'})`);
    }
  };

  /** "Avengers: Doomsday" -> the whole title plus each side of the colon. */
  const termsOf = (name) => {
    const out = [];
    const full = String(name || '').trim();
    if (!full) return out;
    out.push(full);
    for (const part of full.split(/\s*[:\-–]\s+/)) out.push(part);
    return out.filter((t) => {
      const words = t.trim().split(/\s+/);
      return (words.length > 1 || t.length >= 6) && !GENERIC.has(t.toLowerCase());
    });
  };

  async function load() {
    if (!apiKey) return [];
    const lists = await Promise.allSettled([
      get('/trending/all/week'),
      get('/trending/person/week'),
      get('/movie/upcoming'),
      get('/trending/all/day'),
    ]);
    const terms = new Set();
    for (const l of lists) {
      if (l.status !== 'fulfilled') continue;
      for (const r of l.value.slice(0, 20)) for (const t of termsOf(r.title || r.name)) terms.add(t);
    }
    return [...terms].slice(0, 250);
  }

  return { load, termsOf };
}

module.exports = { createTrendTerms };
