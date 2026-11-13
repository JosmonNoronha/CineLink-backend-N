'use strict';

const axios = require('axios');
const { isMultiSeason, encode } = require('./seasons');

/**
 * Episode names for a show, from TMDB: [{ key, name }] (key = catalog key, see seasons.js).
 * `episodeNames` in shows.js adds extra spellings or fixes: [{ season?, episode, name }].
 * The key is never put in an error message or log.
 */
function createEpisodeNames({ apiKey, http = axios, base = 'https://api.themoviedb.org/3' } = {}) {
  if (!apiKey) throw new Error('TMDB_API_KEY is needed for name matching');
  const bearer = /^ey/.test(apiKey) || apiKey.length > 40; // a v4 token goes in a header, a v3 key in the query
  const get = async (path) => {
    try {
      const res = await http.get(`${base}${path}`, {
        params: bearer ? { language: 'en-US' } : { api_key: apiKey, language: 'en-US' },
        headers: bearer ? { Authorization: `Bearer ${apiKey}` } : undefined,
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw new Error(`TMDB request failed (${err.response?.status || err.code || 'network'})`);
    }
  };

  async function forShow(show) {
    let seasons = [show.season || 1];
    if (isMultiSeason(show)) {
      const info = await get(`/tv/${show.tmdbId}`);
      const count = Number(info?.number_of_seasons) || 1;
      seasons = Array.from({ length: count }, (_, i) => i + 1);
    }
    const out = [];
    for (const season of seasons) {
      const data = await get(`/tv/${show.tmdbId}/season/${season}`);
      for (const ep of data?.episodes || []) {
        if (ep?.name && Number(ep.episode_number) > 0) out.push({ key: encode(show, season, Number(ep.episode_number)), name: ep.name });
      }
    }
    for (const extra of show.episodeNames || []) {
      out.push({ key: encode(show, extra.season || show.season || 1, extra.episode), name: extra.name });
    }
    return out;
  }

  return { forShow };
}

module.exports = { createEpisodeNames };
