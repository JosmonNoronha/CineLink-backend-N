'use strict';

/*
  Matching a video to an episode by its NAME, for shows whose YouTube titles carry no episode number
  ("Dhindora | Lag Gayi | Bhuvan Bam"). A show opts in with `nameMatch: true` in shows.js.

  The names come from TMDB (see tmdbNames.js) and can be extended with `episodeNames` in shows.js
  (for a spelling YouTube uses that TMDB does not).
  A title is accepted only when it already matches the show and contains exactly one episode's name,
  as whole words. Anything doubtful (two names, a name shared by two episodes, a generic name like
  "Finale", a name that is just part of the show's title) is left out: a missed episode is better
  than the wrong episode. An episode number in the title always wins over a name.
*/

const GENERIC = /^(?:(?:episode|ep|part|chapter|season)\s*\d*|\d+|finale|pilot|special)$/;

/** Lowercase, accents removed, punctuation turned into single spaces. Keeps every script (Devanagari too). */
const normaliseName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Latin accents only; Devanagari vowel signs are not in this range
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * entries: [{ key, name }]  (key = catalog key, see seasons.js)
 * Returns { entries: [{ norm, key, name }] longest first, byKey: Map(key -> name), skipped: [name], showNorm }
 */
function buildNameIndex(entries, show) {
  const showNorm = normaliseName(show?.title);
  const byNorm = new Map();
  const skipped = [];
  for (const { key, name } of entries || []) {
    const norm = normaliseName(name);
    // A name that is only part of the show's own title ("Dhindora", or "Hard" for "Lie Hard") would match every episode.
    const inShowTitle = showNorm && ` ${showNorm} `.includes(` ${norm} `);
    if (norm.length < 4 || GENERIC.test(norm) || inShowTitle) {
      skipped.push(name);
      continue;
    }
    const prev = byNorm.get(norm);
    if (!prev) byNorm.set(norm, { norm, key, name, ambiguous: false });
    else if (prev.key !== key) prev.ambiguous = true; // two episodes share this name: cannot tell them apart
  }
  const list = [];
  for (const e of byNorm.values()) {
    if (e.ambiguous) skipped.push(e.name);
    else list.push({ norm: e.norm, key: e.key, name: e.name });
  }
  list.sort((a, b) => b.norm.length - a.norm.length);
  const byKey = new Map();
  for (const e of list) if (!byKey.has(e.key)) byKey.set(e.key, e.name);
  return { entries: list, byKey, skipped, showNorm };
}

/** Catalog key of the one episode this title names, or null. */
function matchName(title, index) {
  if (!index || !index.entries.length) return null;
  const t = ` ${normaliseName(title)} `;
  const hits = index.entries.filter((e) => t.includes(` ${e.norm} `));
  if (!hits.length) return null;
  // A name that sits inside a longer matched name is only part of it.
  const top = hits.filter((h) => !hits.some((o) => o.norm.length > h.norm.length && o.norm.includes(h.norm)));
  const keys = new Set(top.map((h) => h.key));
  return keys.size === 1 ? [...keys][0] : null;
}

module.exports = { normaliseName, buildNameIndex, matchName };
