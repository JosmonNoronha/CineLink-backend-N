'use strict';

const { toSource, mergeSources } = require('./matcher');

/**
 * Look for specific missing episodes with a YouTube search (100 quota units each).
 * Only videos uploaded by the show's own channels count, and the usual rules apply.
 * Returns { added: Map n -> sources, tried: [n], why: { n: reason } }.
 */
async function fillGaps({ show, youtube, missing, limit = 30, maxUnits = 4000 }) {
  const ownById = new Map(show.channels.map((c) => [c.id, c]));
  const added = new Map();
  const tried = [];
  const why = {};
  const startUnits = youtube.usage.units;
  let stoppedEarly = null;

  for (const n of missing.slice(0, limit)) {
    if (youtube.usage.units - startUnits + 100 > maxUnits) {
      stoppedEarly = 'maxUnits';
      break;
    }
    let results;
    try {
      results = await youtube.searchVideos(`${show.title} Episode ${n}`);
    } catch (err) {
      if (err.code === 'YOUTUBE_QUOTA') {
        stoppedEarly = 'quota';
        break;
      }
      why[n] = err.code || 'FAILED';
      continue;
    }
    tried.push(n);
    const mine = results.filter((r) => ownById.has(r.channelId));
    if (!mine.length) {
      why[n] = results.length ? 'no result from our channels' : 'no results';
      continue;
    }
    const details = await youtube.videoDetails(mine.map((r) => r.videoId));
    const reasons = [];
    for (const r of mine) {
      const d = details.get(r.videoId);
      if (!d) {
        reasons.push('video unavailable');
        continue;
      }
      const hit = toSource({ ...r, ...d }, show, ownById.get(r.channelId));
      if (hit && hit.n === n) added.set(n, [...(added.get(n) || []), hit.src]);
      else if (hit) reasons.push(`title says episode ${hit.n}`);
      else if (d.seconds < show.minSeconds) reasons.push(`short (${Math.round(d.seconds)}s)`);
      else if (d.embeddable === false) reasons.push('not embeddable');
      else reasons.push(`title not accepted: ${r.title.slice(0, 70)}`);
    }
    if (!added.has(n)) why[n] = reasons.slice(0, 3).join(' | ');
  }
  return { added, tried, why, stoppedEarly, quotaUnits: youtube.usage.units - startUnits };
}

/** Episode numbers 1..upTo that have no source. */
const missingNumbers = (have, upTo) => {
  const out = [];
  for (let n = 1; n <= upTo; n += 1) if (!have.has(n)) out.push(n);
  return out;
};

module.exports = { fillGaps, missingNumbers, mergeSources };
