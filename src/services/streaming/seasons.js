'use strict';

/*
  Some shows restart their episode numbers every season ("Ep. 1" in season 1, "S2 Ep 01" in season 2).
  The catalog stores every episode of a show under one number, so a season is folded into it:

      key = (season - 1) * 1000 + episode

  Season 1 keys are the plain episode numbers, so single-season shows (and everything already stored
  for them) are unchanged. A show opts in with `seasonInTitle: true` in shows.js; its maxEpisode must
  stay below 1000.
*/

const SPAN = 1000;

const isMultiSeason = (show) => Boolean(show && show.seasonInTitle);

const encode = (show, season, episode) =>
  isMultiSeason(show) ? (Number(season) - 1) * SPAN + Number(episode) : Number(episode);

/** key -> { season, episode } */
const decode = (show, key) =>
  isMultiSeason(show)
    ? { season: Math.floor((key - 1) / SPAN) + 1, episode: ((key - 1) % SPAN) + 1 }
    : { season: show.season || 1, episode: Number(key) };

/** Season requested by a client, or the show's own default. */
const resolveSeason = (show, season) => {
  const n = Number(season);
  return Number.isInteger(n) && n >= 1 ? n : show.season || 1;
};

/** Readable name for logs and reports: 531 for a normal show, "S2E5" for a multi-season one. */
const label = (show, key) => {
  if (!isMultiSeason(show)) return Number(key);
  const { season, episode } = decode(show, key);
  return `S${season}E${episode}`;
};

/** What to type into YouTube search to find one episode. */
const searchQuery = (show, key) => {
  if (!isMultiSeason(show)) return `${show.title} Episode ${key}`;
  const { season, episode } = decode(show, key);
  return `${show.title} S${season} Ep ${episode}`;
};

/** Keys with no source. Multi-season: per season, up to that season's newest episode (or `upTo`). */
function missingKeys(show, have, { season, upTo } = {}) {
  const out = [];
  if (!isMultiSeason(show)) {
    const top = upTo ?? Math.max(0, ...have.keys());
    for (let n = 1; n <= top; n += 1) if (!have.has(n)) out.push(n);
    return out;
  }
  const newest = new Map(); // season -> newest episode number stored
  for (const key of have.keys()) {
    const d = decode(show, key);
    newest.set(d.season, Math.max(newest.get(d.season) || 0, d.episode));
  }
  const seasons = season ? [Number(season)] : [...newest.keys()].sort((a, b) => a - b);
  for (const s of seasons) {
    const top = upTo ?? newest.get(s) ?? 0;
    for (let e = 1; e <= top; e += 1) {
      const key = encode(show, s, e);
      if (!have.has(key)) out.push(key);
    }
  }
  return out;
}

module.exports = { SPAN, isMultiSeason, encode, decode, resolveSeason, label, searchQuery, missingKeys };
