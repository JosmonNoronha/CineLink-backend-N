'use strict';

const { parseFeed, titleKey } = require('./parse');
const { LIMITS } = require('./sources');
const { buildTerms, scoreItem, isJunk } = require('./rank');

const STOP = new Set(['with','from','that','this','will','have','after','about','their','into','first','what','when','trailer','movie','movies','film','films','series','show','season','review','news','says','just','more','than','over','your','here','been','also','would','could']);
function tokens(title) {
  const set = new Set();
  for (const w of String(title).toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !STOP.has(w)) set.add(w);
  return set;
}
function similar(a, b) {
  const small = Math.min(a.size, b.size);
  if (small < 2) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared >= Math.min(3, small) && shared / (a.size + b.size - shared) >= 0.4;
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        results[n] = await fn(items[n]);
      }
    })
  );
  return results;
}

/** Merge fresh items into the stored ones: dedupe by id and by headline, cap per source and overall. */
function mergeItems(stored, fresh, sources, { now, limits = LIMITS, terms = buildTerms() }) {
  const priority = new Map(sources.map((s) => [s.id, s.priority ?? 9]));
  const known = new Set(sources.map((s) => s.id));
  const cutoff = now - limits.maxAgeDays * 86400000;
  const byId = new Map();
  for (const it of [...stored, ...fresh]) {
    if (!known.has(it.source) || it.publishedAt < cutoff || isJunk(it.title)) continue;
    byId.set(it.id, it); // fresh (later in the list) replaces stored
  }
  const all = [...byId.values()].sort((a, b) => b.publishedAt - a.publishedAt || (a.id < b.id ? -1 : 1));

  const seenTitles = new Map();
  const perSource = new Map();
  const out = [];
  for (const it of all) {
    const key = titleKey(it.title);
    const twin = seenTitles.get(key);
    if (twin) {
      // Same headline from two sources: keep the higher-priority one.
      if ((priority.get(it.source) ?? 9) < (priority.get(twin.source) ?? 9)) {
        out[out.indexOf(twin)] = it;
        seenTitles.set(key, it);
      }
      continue;
    }
    const n = perSource.get(it.source) || 0;
    if (n >= limits.maxPerSource) continue;
    perSource.set(it.source, n + 1);
    seenTitles.set(key, it);
    out.push(it);
    if (out.length >= limits.maxStored) break;
  }
  // "buzz": how many OTHER sources ran a similar headline. It powers the Trending view.
  const toks = new Map(all.map((it) => [it.id, tokens(it.title)]));
  return out.map((it) => {
    const mine = toks.get(it.id);
    const others = new Set();
    for (const o of all) {
      if (o.source !== it.source && !others.has(o.source) && similar(mine, toks.get(o.id))) others.add(o.source);
    }
    const withBuzz = { ...it, buzz: others.size };
    return { ...withBuzz, score: scoreItem(withBuzz, { terms, sourcePriority: priority.get(it.source) }) };
  });
}

/**
 * Fetch every enabled source, merge, save. One bad feed never blocks the others, and if every feed
 * fails the stored feed is left exactly as it was.
 */
async function syncNews({ sources, store, fetchFeed, getTrendTerms, now = () => Date.now(), dryRun = false, limits = LIMITS }) {
  const [feed, state, meta] = await Promise.all([store.loadFeed(), store.loadState(), store.loadMeta()]);
  const disabled = new Set(meta.disabledSources);
  const active = sources.filter((s) => !disabled.has(s.id));
  const at = now();
  const nextState = { ...state };
  const fresh = [];
  const report = { sources: {}, fetched: 0, notModified: 0, failed: 0 };

  await pool(active, 4, async (source) => {
    const prev = state[source.id] || {};
    try {
      const res = await fetchFeed(source, prev);
      if (res.status === 304) {
        report.notModified += 1;
        report.sources[source.id] = { status: 'not-modified' };
        nextState[source.id] = { ...prev, status: 'ok', lastCheckAt: at, failures: 0, error: null };
        return;
      }
      const items = parseFeed(res.body, source, { now: at, maxAgeDays: limits.maxAgeDays, limit: limits.maxPerFeedRead });
      fresh.push(...items);
      report.fetched += 1;
      const withImage = items.filter((i) => i.image).length;
      report.sources[source.id] = { status: 'ok', items: items.length, withImage };
      nextState[source.id] = {
        etag: res.etag || null,
        lastModified: res.lastModified || null,
        status: 'ok',
        lastCheckAt: at,
        lastOkAt: at,
        failures: 0,
        error: null,
        items: items.length,
        withImage,
        newest: items[0]?.publishedAt || prev.newest || null,
      };
    } catch (err) {
      report.failed += 1;
      const failures = (prev.failures || 0) + 1;
      report.sources[source.id] = { status: 'failed', error: err.message };
      nextState[source.id] = { ...prev, status: 'failed', lastCheckAt: at, failures, error: String(err.message).slice(0, 120) };
    }
  });

  const succeeded = report.fetched + report.notModified;
  if (succeeded === 0 && active.length) {
    if (!dryRun) await store.saveState(nextState);
    report.saved = false;
    return report;
  }

  let trend = [];
  try {
    trend = getTrendTerms ? await getTrendTerms() : [];
  } catch (err) {
    report.trendError = err.message; // ranking falls back to the built-in HOT_TERMS
  }
  report.trendTerms = trend.length;
  const terms = buildTerms(trend);
  const items = mergeItems(feed.items || [], fresh, sources, { now: at, limits, terms });
  report.total = items.length;
  report.added = items.length ? items.filter((i) => !(feed.items || []).some((s) => s.id === i.id)).length : 0;
  report.saved = !dryRun;
  if (!dryRun) {
    await store.saveFeed(items, at);
    await store.saveState(nextState);
  }
  return report;
}

module.exports = { syncNews, mergeItems, similar, tokens };
