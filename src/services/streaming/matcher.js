'use strict';

/*
  Pure rules: which YouTube videos are full episodes, which episode number each one is,
  and which video to play for a viewer in a given country. No network, no database.
*/

const HARD_EXCLUDE =
  /\b(full movie|compilation|weekly|reli[vw]|recap|teaser|promo|trailer|behind the scenes|making of|interview)\b|#shorts|\d{3,5}\s*(?:to|-|–|—)\s*\d{3,5}/i;

/** Episode number from a title, or null. Ranges ("Ep 01 - 05") and years ("30 Sep 2026") are rejected. */
function parseEpisodeNumber(title) {
  const t = String(title || '');
  const patterns = [
    /\b(?:episode|episodes|epi|ep)\s*[.!]?\s*[-:#]?\s*(\d{1,5})\b(?!\s*(?:-|–|—|to)\s*\d{1,5}(?!\d|\s*(?:st|nd|rd|th)\b))/i,
    /\bnew\s+full\s+(\d{3,5})\b/i,
    /(?:एपिसोड|एपी)\s*[!.]?\s*[-:#]?\s*(\d{1,5})\b(?!\s*(?:-|–|—|to)\s*\d)/,
    /\bE(\d{1,5})\b/,
    /#\s*(\d{3,5})\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Compact region rule from the YouTube API: {a:[..allowed]} or {b:[..blocked]} or null. */
function compactRegion(regionRestriction) {
  if (!regionRestriction) return null;
  if (Array.isArray(regionRestriction.allowed)) return { a: [...regionRestriction.allowed].sort() };
  if (Array.isArray(regionRestriction.blocked)) return { b: [...regionRestriction.blocked].sort() };
  return null;
}

function playableIn(rule, country) {
  if (!rule) return true;
  const c = String(country || '').toUpperCase();
  if (rule.a) return rule.a.includes(c);
  if (rule.b) return !rule.b.includes(c);
  return true;
}

/** ISO 8601 duration ("PT22M10S") to seconds. */
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d = 0, h = 0, mi = 0, s = 0] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(mi) * 60 + Number(s);
}

/** Title-only check, used before spending quota on video details. */
function titleLooksLikeEpisode(title, show) {
  const t = String(title || '');
  if (!show.match.test(t) || HARD_EXCLUDE.test(t)) return false;
  const n = parseEpisodeNumber(t);
  return Boolean(n) && n <= show.maxEpisode;
}

/**
 * Turn one video into a source for an episode, or null if it is not a single full episode.
 * video: { videoId, title, publishedAt, seconds, embeddable, privacy, ageRestricted, region (compact: {a:[..]} | {b:[..]} | null) }
 */
function toSource(video, show, channel) {
  const title = String(video.title || '');
  if (!show.match.test(title)) return null;
  if (HARD_EXCLUDE.test(title)) return null;
  if ((video.seconds || 0) < show.minSeconds) return null;
  if (video.embeddable === false || (video.privacy && video.privacy !== 'public') || video.ageRestricted)
    return null;
  const n = parseEpisodeNumber(title);
  if (!n || n > show.maxEpisode) return null;
  return {
    n,
    src: {
      v: video.videoId,
      c: channel.key,
      p: channel.priority,
      s: Math.round(video.seconds),
      r: video.region || null, // already compact: the YouTube client converts it
      t: title.slice(0, 110),
      d: video.publishedAt ? Date.parse(video.publishedAt) || 0 : 0,
    },
  };
}

/** Order sources: preferred channel first, then the longer video, then the newest. */
function orderSources(list) {
  return [...list].sort((a, b) => a.p - b.p || b.s - a.s || b.d - a.d);
}

/** Merge new sources into an existing list, one entry per videoId (new data wins). */
function mergeSources(existing, incoming) {
  const byId = new Map();
  [...(existing || []), ...(incoming || [])].forEach((s) => byId.set(s.v, s));
  return orderSources([...byId.values()]);
}

/** Best video to play in a country, plus one fallback from a different video. */
function pickFor(sources, country, blocked = new Set()) {
  const ok = orderSources((sources || []).filter((s) => !blocked.has(s.v) && playableIn(s.r, country)));
  if (!ok.length) return null;
  return { primary: ok[0], alt: ok[1] || null };
}

module.exports = {
  titleLooksLikeEpisode,
  parseEpisodeNumber,
  parseDuration,
  compactRegion,
  playableIn,
  toSource,
  orderSources,
  mergeSources,
  pickFor,
};
