'use strict';

/**
 * What counts as "big news". Every story gets a static significance `score` at sync time;
 * the app's Trending / This week views rank by score plus a recency bonus (see service.js).
 *
 *   + source tier        trade papers and national outlets over blogs
 *   + buzz               other outlets ran the same story
 *   + trending entities  titles and people trending on TMDB right now, plus HOT_TERMS below
 *   + news verbs         "cast as", "joins", "renewed", "box office", ...
 *   - listicles          "10 best ...", "everything we know", "how to watch" ...
 *   x junk               deals, quizzes, horoscopes ... never stored
 */

// Edit freely: franchises, studios, awards and stars that should always lift a story.
const HOT_TERMS = [
  'james bond', 'bond 26', '007', 'avengers', 'doomsday', 'secret wars', 'marvel', 'mcu', 'star wars', 'dc studios',
  'superman', 'batman', 'spider man', 'harry potter', 'game of thrones', 'stranger things', 'the last of us',
  'squid game', 'house of the dragon', 'oscars', 'academy awards', 'emmys', 'golden globes', 'cannes', 'bafta',
  'netflix', 'disney', 'warner bros', 'christopher nolan', 'denis villeneuve', 'dune', 'avatar', 'mission impossible',
  'fast and furious', 'jurassic',
  // India
  'shah rukh khan', 'salman khan', 'aamir khan', 'alia bhatt', 'deepika padukone', 'ranbir kapoor', 'prabhas',
  'allu arjun', 'rajamouli', 'rajinikanth', 'kamal haasan', 'jr ntr', 'ram charan', 'mahesh babu', 'pushpa',
  'kalki', 'bigg boss', 'panchayat', 'ramayana', 'filmfare', 'national film awards',
];

const JUNK = /\b(deals?|discount(s|ed)?|coupon|promo code|horoscope|quiz|giveaway|sweepstakes|gift guide|wordle|connections hints|on sale|black friday|cyber monday|prime day)\b/i;
const LISTICLE = /(\b(best|worst|top \d+|ranked|ranking|every|all \d+|\d+ (best|worst|reasons|things|movies|shows|films)|things you|reasons why|hidden details|easter eggs?|fan theor(y|ies)|explained|how to (watch|stream)|where to (watch|stream)|what to watch|everything (we know|you need))\b)/i;
const BOOST = /\b(cast(ed)? as|to star|joins|set to (play|direct|star)|lands (the )?role|officially|confirmed?|announces?|announced|first look|release date|trailer|teaser|renewed|cancel(l)?ed|box office|opening weekend|record|dies|dead|death|passes away|wins|nominations?|oscar|emmy|golden globe|cannes|exclusive|replaces|steps down|resigns)\b/i;

const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const hits = (text, terms) => terms.reduce((n, t) => (text.includes(t) ? n + 1 : n), 0);

/** Normalised, de-duplicated term list from the static list plus whatever TMDB says is trending. */
function buildTerms(trend = []) {
  const out = new Set();
  for (const raw of [...HOT_TERMS, ...trend]) {
    const t = norm(raw);
    if (t.trim().length >= 3) out.add(t);
  }
  return [...out];
}

const isJunk = (title) => JUNK.test(title);

function scoreItem(item, { terms, sourcePriority = 3 } = {}) {
  let score = sourcePriority <= 1 ? 3 : sourcePriority === 2 ? 1.5 : 0;
  score += 3 * Math.min(item.buzz || 0, 4);
  if (terms?.length) {
    score += Math.min(8, 4 * hits(norm(item.title), terms));
    score += Math.min(3, 1.5 * hits(norm(item.excerpt || ''), terms));
  }
  if (BOOST.test(item.title)) score += 2;
  if (LISTICLE.test(item.title)) score -= 3;
  return Math.round(score * 10) / 10;
}

const HOUR = 3600000;
/** Ranking value at read time: significance plus a bonus that fades over 48 hours. */
const rankOf = (item, now) => (item.score || 0) + Math.max(0, 8 - (now - item.publishedAt) / (6 * HOUR));

module.exports = { HOT_TERMS, buildTerms, scoreItem, isJunk, rankOf, norm };
