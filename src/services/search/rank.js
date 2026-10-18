// src/services/search/rank.js  (NEW FILE)
'use strict';

// Accent/punctuation/superscript-insensitive text for comparing titles.
//   "Amélie" → "amelie", "Alien³" → "alien3", "Spider-Man" → "spider man"
const foldText = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const TRAILING_YEAR = /\s+\(?(?:19|20)\d{2}\)?$/;

/**
 * Re-rank TMDb title results so the title the user typed comes first.
 *   tier 0: exact match ("Heat"; "spiderman" matches "Spider-Man")
 *   tier 1: title starts with the query as a whole word ("Alien: Romulus")
 *   tier 2: everything else, in TMDb's original order
 * Tiers 0 and 1 are ordered by popularity, so a well-known title beats an
 * obscure one with the same name. A trailing year ("Dune 2021") is ignored.
 */
function rankTitles(items, query) {
  const list = Array.isArray(items) ? items : [];
  const q = foldText(String(query || '').replace(TRAILING_YEAR, ''));
  if (!q) return list;
  const qCompact = q.replace(/ /g, '');

  const tierOf = (item) => {
    const t = foldText(item.Title);
    if (t === q || t.replace(/ /g, '') === qCompact) return 0;
    if (t.startsWith(`${q} `)) return 1;
    return 2;
  };

  return list
    .map((item, index) => ({ item, index, tier: tierOf(item) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier <= 1) {
        const diff = (b.item._popularity || 0) - (a.item._popularity || 0);
        if (diff !== 0) return diff;
      }
      return a.index - b.index;
    })
    .map((x) => x.item);
}

module.exports = { foldText, rankTitles };