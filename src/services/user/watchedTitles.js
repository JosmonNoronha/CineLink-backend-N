'use strict';

/**
 * One "watched" record per title, independent of any watchlist.
 *
 * Lives in the same document the episode ticks already use:
 *   users/{uid}/watched/{contentId}
 *     s{N}e{M}: { watchedAt, season, episode }   (existing, untouched)
 *     kind:      'movie' | 'series'
 *     watched:   boolean   movie: watched.  series: the whole series was marked watched
 *     watchedAt: ISO string
 *     meta:      { title, poster, year, totalEpisodes, totalSeasons, seasonCounts }
 *
 * Series status is never stored. It is derived from the ticked episodes:
 *   completed  = watched flag || (totalEpisodes known && ticked >= totalEpisodes)
 *   inProgress = ticked > 0 and not completed
 */

const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');
const { createSeriesTotals } = require('../tmdb/seriesTotals');

const EPISODE_KEY = /^s\d+e\d+$/;
const MAX_TITLES = 1000;
const MAX_BULK_EPISODES = 3000;
const TOTALS_REFRESH_MS = 2 * 24 * 60 * 60 * 1000; // re-check a show's episode count every couple of days
const MAX_TOTALS_PER_LIST = 12;

// Where episode totals come from. Tests swap it with setTotalsProvider().
let totalsProvider = createSeriesTotals();
function setTotalsProvider(p) {
  totalsProvider = p || createSeriesTotals();
}

/** Totals for a "tmdb:tv:ID" series, or null. Never throws. */
async function lookupTotals(contentId) {
  const parsed = parseContentId(contentId);
  if (parsed.type !== 'tv') return null;
  try {
    return await totalsProvider.get(parsed.tmdbId);
  } catch (_err) {
    return null;
  }
}

function totalsToMeta(t) {
  return t
    ? { totalSeasons: t.totalSeasons, totalEpisodes: t.totalEpisodes, seasonCounts: t.seasonCounts, totalsAt: new Date().toISOString() }
    : {};
}

function totalsStale(meta) {
  const at = meta && meta.totalsAt ? Date.parse(meta.totalsAt) : 0;
  return !!at && Date.now() - at > TOTALS_REFRESH_MS;
}

function tickedCount(data) {
  return episodeEntries(data).length;
}

/**
 * A series that was finished because every episode was ticked reopens when more episodes have aired
 * (a new season or episode). One marked watched without ticks (completedBy unset) is left alone.
 */
async function reopenIfGrown(uid, contentId, ref, data) {
  const total = data.meta && data.meta.totalEpisodes;
  if (!data.watched || data.completedBy !== 'episodes' || !total || tickedCount(data) >= total) return false;
  await ref.set(
    {
      watched: false,
      watchedAt: admin.firestore.FieldValue.delete(),
      completedBy: admin.firestore.FieldValue.delete(),
    },
    { merge: true }
  );
  await syncLists(uid, contentId, false).catch(() => 0);
  return true;
}

function episodesFromCounts(seasonCounts) {
  const out = [];
  for (const [s, c] of Object.entries(seasonCounts || {})) {
    for (let e = 1; e <= c; e += 1) out.push({ season: Number(s), episode: e });
  }
  return out;
}

function userRef(uid) {
  return getFirestore().collection('users').doc(uid);
}
function watchedCol(uid) {
  return userRef(uid).collection('watched');
}
function listsCol(uid) {
  return userRef(uid).collection('watchlists');
}

function parseContentId(contentId) {
  const id = String(contentId || '').trim();
  const m = /^tmdb:(movie|tv):(\d+)$/.exec(id);
  if (m) return { id, tmdbId: m[2], type: m[1], imdb: null };
  if (/^tt\d+$/.test(id)) return { id, tmdbId: null, type: null, imdb: id };
  return { id, tmdbId: null, type: null, imdb: null };
}

function kindFromType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'series' || t === 'tv' ? 'series' : 'movie';
}

function cleanStr(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
}

function cleanCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : undefined;
}

function cleanMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const out = {};
  const title = cleanStr(m.title, 200);
  const poster = cleanStr(m.poster, 500);
  const year = cleanStr(m.year, 12);
  if (title) out.title = title;
  if (poster) out.poster = poster;
  if (year) out.year = year;
  const te = cleanCount(m.totalEpisodes);
  const ts = cleanCount(m.totalSeasons);
  if (te) out.totalEpisodes = te;
  if (ts) out.totalSeasons = ts;
  if (m.seasonCounts && typeof m.seasonCounts === 'object') {
    const sc = {};
    for (const [k, v] of Object.entries(m.seasonCounts)) {
      const sn = Number(k);
      const c = cleanCount(v);
      if (Number.isInteger(sn) && sn >= 0 && sn < 1000 && c) sc[String(sn)] = c;
    }
    if (Object.keys(sc).length) out.seasonCounts = sc;
  }
  return out;
}

function episodeEntries(data) {
  return Object.entries(data || {}).filter(([k, v]) => EPISODE_KEY.test(k) && v && typeof v === 'object');
}

function typeOfItem(item) {
  const t = String(item?.media_type || item?.Type || '').toLowerCase();
  if (t === 'tv' || t === 'series') return 'tv';
  if (t === 'movie') return 'movie';
  return null;
}

function itemMatches(item, parsed) {
  if (!item) return false;
  if (String(item.imdbID || '') === parsed.id) return true;
  if (parsed.tmdbId && String(item.tmdb_id || '') === parsed.tmdbId) {
    const t = typeOfItem(item);
    return !t || t === parsed.type;
  }
  return false;
}

function contentIdFromItem(item) {
  const imdb = String(item?.imdbID || '').trim();
  // Already in the form Details uses: tmdb:movie:603
  if (/^tmdb:(movie|tv):\d+$/.test(imdb)) return imdb;
  // Lists store many titles as "tmdb:603" plus a tmdb_id; rebuild the full id with the media type.
  const legacy = /^tmdb:(\d+)$/.exec(imdb);
  const tmdbId = item?.tmdb_id || (legacy && legacy[1]);
  if (tmdbId) return `tmdb:${typeOfItem(item) || 'movie'}:${tmdbId}`;
  return imdb || null;
}

function metaFromItem(item) {
  return cleanMeta({
    title: item?.Title || item?.title || item?.name,
    poster: item?.Poster || item?.poster || item?.poster_path,
    year: item?.Year || item?.year,
  });
}

// ─── Summaries ──────────────────────────────────────────────────────────────

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return null;
}

function summarize(contentId, data) {
  const meta = data.meta || {};
  // Documents written by older app versions have no kind: episode ticks on a real title id mean a series.
  let kind = data.kind === 'series' || data.kind === 'movie' ? data.kind : null;
  if (!kind) {
    const hasEpisodes = episodeEntries(data).length > 0;
    kind = /^tmdb:tv:/.test(contentId) || (hasEpisodes && /^(tmdb:|tt)/.test(contentId)) ? 'series' : 'movie';
  }
  const base = {
    contentId,
    type: kind,
    title: meta.title || null,
    poster: meta.poster || null,
    year: meta.year || null,
  };

  if (kind === 'movie') {
    if (!data.watched) return null;
    return { ...base, status: 'completed', watchedAt: toIso(data.watchedAt) };
  }

  const eps = episodeEntries(data);
  const ticked = eps.length;
  if (!data.watched && ticked === 0) return null;

  const total = meta.totalEpisodes || null;
  const completed = !!data.watched || (!!total && ticked >= total);

  let last = null;
  let lastAt = null;
  const perSeason = {};
  for (const [, v] of eps) {
    const s = Number(v.season);
    const e = Number(v.episode);
    perSeason[s] = (perSeason[s] || 0) + 1;
    if (!last || s > last.season || (s === last.season && e > last.episode)) last = { season: s, episode: e };
    const at = typeof v.watchedAt === 'string' ? v.watchedAt : null;
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  }

  let completedSeasons = null;
  if (meta.seasonCounts) {
    completedSeasons = Object.entries(meta.seasonCounts).filter(([s, c]) => (perSeason[s] || 0) >= c).length;
  }

  let progress = null;
  if (completed) progress = 1;
  else if (total) progress = Math.min(1, ticked / total);

  return {
    ...base,
    status: completed ? 'completed' : 'inProgress',
    watchedAt: toIso(data.watchedAt) || lastAt,
    episodesWatched: ticked,
    totalEpisodes: total,
    totalSeasons: meta.totalSeasons || null,
    completedSeasons,
    progress,
    lastEpisode: last,
  };
}

// ─── Lazy one-time migration from watchlists ────────────────────────────────

async function migrateFromWatchlists(uid) {
  const uref = userRef(uid);
  const uSnap = await uref.get();
  if (uSnap.exists && uSnap.data().watchedTitlesMigratedAt) return { migrated: 0, skipped: true };

  const listsSnap = await listsCol(uid).limit(200).get();
  const found = new Map(); // contentId -> { kind, meta, watchedAt }
  for (const d of listsSnap.docs) {
    const movies = Array.isArray(d.data().movies) ? d.data().movies : [];
    for (const item of movies) {
      if (!item || !item.watched) continue;
      const cid = contentIdFromItem(item);
      if (!cid) continue;
      if (!found.has(cid)) {
        found.set(cid, {
          kind: kindFromType(item.media_type || item.Type),
          meta: metaFromItem(item),
          watchedAt: toIso(item.watchedAt) || new Date().toISOString(),
        });
      }
    }
  }

  let migrated = 0;
  for (const [cid, v] of found) {
    const ref = watchedCol(uid).doc(cid);
    const existing = await ref.get();
    if (existing.exists && existing.data().watched) continue; // never overwrite
    await ref.set(
      { kind: v.kind, watched: true, watchedAt: v.watchedAt, meta: v.meta, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    migrated += 1;
  }

  await uref.set({ watchedTitlesMigratedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { migrated, skipped: false };
}

// Series saved before totals existed (or a running show that may have new episodes): fill them in.
async function fillMissingTotals(uid, docs) {
  const stale = [];
  for (const d of docs) {
    const data = d.data() || {};
    const s = summarize(d.id, data);
    if (!s || s.type !== 'series') continue;
    const at = data.meta && data.meta.totalsAt ? Date.parse(data.meta.totalsAt) : 0;
    const missing = !(data.meta && data.meta.totalEpisodes);
    if ((missing && !at) || totalsStale(data.meta)) stale.push(d);
    if (stale.length >= MAX_TOTALS_PER_LIST) break;
  }
  await Promise.all(
    stale.map(async (d) => {
      const t = await lookupTotals(d.id);
      if (!t) return;
      const data = d.data() || {};
      const meta = { ...(data.meta || {}), ...totalsToMeta(t) };
      await d.ref.set({ meta }, { merge: true });
      await reopenIfGrown(uid, d.id, d.ref, { ...data, meta });
    })
  );
  return stale.length;
}

async function listWatchedTitles(uid) {
  await migrateFromWatchlists(uid);
  let snap = await watchedCol(uid).limit(MAX_TITLES).get();
  if (await fillMissingTotals(uid, snap.docs)) snap = await watchedCol(uid).limit(MAX_TITLES).get();
  const items = [];
  for (const d of snap.docs) {
    const s = summarize(d.id, d.data() || {});
    if (s) items.push(s);
  }
  items.sort((a, b) => String(b.watchedAt || '').localeCompare(String(a.watchedAt || '')));
  return {
    items,
    counts: {
      movies: items.filter((i) => i.type === 'movie').length,
      series: items.filter((i) => i.type === 'series').length,
      inProgress: items.filter((i) => i.status === 'inProgress').length,
    },
  };
}

async function getTitleState(uid, contentId) {
  const ref = watchedCol(uid).doc(contentId);
  let snap = await ref.get();
  // Opening a finished series also checks whether more episodes have aired.
  if (snap.exists && snap.data().kind === 'series' && snap.data().completedBy === 'episodes' && totalsStale(snap.data().meta)) {
    const t = await lookupTotals(contentId);
    if (t) {
      await ref.set({ meta: { ...(snap.data().meta || {}), ...totalsToMeta(t) } }, { merge: true });
      snap = await ref.get();
      if (await reopenIfGrown(uid, contentId, ref, snap.data())) snap = await ref.get();
    }
  }
  const data = snap.exists ? snap.data() : {};
  const s = summarize(contentId, data) || null;
  return { watched: !!s && s.status === 'completed', summary: s };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function syncLists(uid, contentId, watched) {
  const parsed = parseContentId(contentId);
  const snap = await listsCol(uid).limit(200).get();
  let touched = 0;
  for (const d of snap.docs) {
    const movies = Array.isArray(d.data().movies) ? d.data().movies : [];
    if (!movies.some((m) => itemMatches(m, parsed) && !!m.watched !== watched)) continue;
    await getFirestore().runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists) return;
      const items = Array.isArray(fresh.data().movies) ? fresh.data().movies : [];
      let changed = false;
      const next = items.map((m) => {
        if (!itemMatches(m, parsed) || !!m.watched === watched) return m;
        changed = true;
        return { ...m, watched, watchedAt: watched ? admin.firestore.Timestamp.now() : null };
      });
      if (changed) {
        tx.set(d.ref, { movies: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        touched += 1;
      }
    });
  }
  return touched;
}

/**
 * Mark a whole title watched or unwatched.
 * Series: marking watched ticks every supplied episode; unmarking clears all ticks.
 */
async function setTitleWatched(uid, contentId, { type, watched, meta, episodes }) {
  const kind = kindFromType(type);
  const cleaned = cleanMeta(meta);
  let eps = Array.isArray(episodes) ? episodes : [];

  // Marking a whole series: the server knows the episode list, so the app does not have to load every season.
  if (kind === 'series' && watched) {
    let counts = cleaned.seasonCounts;
    if (!eps.length || !cleaned.totalEpisodes) {
      const t = await lookupTotals(contentId);
      if (t) {
        Object.assign(cleaned, totalsToMeta(t));
        counts = t.seasonCounts;
      }
    }
    if (!eps.length && counts) eps = episodesFromCounts(counts);
  }
  if (eps.length > MAX_BULK_EPISODES) {
    throw new AppError('Too many episodes', 413, 'RESOURCE_LIMIT');
  }

  const ref = watchedCol(uid).doc(contentId);
  const nowIso = new Date().toISOString();

  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const patch = { kind, updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    if (Object.keys(cleaned).length) patch.meta = { ...(data.meta || {}), ...cleaned };

    if (watched) {
      patch.watched = true;
      if (!data.watched) patch.watchedAt = nowIso;
      if (kind === 'series') {
        const keys = new Set(episodeEntries(data).map(([k]) => k));
        for (const e of eps) {
          const s = Number(e.season);
          const n = Number(e.episode);
          if (!Number.isInteger(s) || !Number.isInteger(n) || s < 0 || n < 1) continue;
          const key = `s${s}e${n}`;
          keys.add(key);
          if (!data[key]) patch[key] = { watchedAt: nowIso, season: s, episode: n };
        }
        // Finished because every known episode is ticked -> may reopen if more episodes air.
        const total = (patch.meta || data.meta || {}).totalEpisodes;
        patch.completedBy = total && keys.size >= total ? 'episodes' : admin.firestore.FieldValue.delete();
      }
    } else {
      patch.watched = false;
      patch.watchedAt = admin.firestore.FieldValue.delete();
      patch.completedBy = admin.firestore.FieldValue.delete();
      if (kind === 'series') {
        for (const [k] of episodeEntries(data)) patch[k] = admin.firestore.FieldValue.delete();
      }
    }
    tx.set(ref, patch, { merge: true });
  });

  const listsUpdated = await syncLists(uid, contentId, !!watched);
  const state = await getTitleState(uid, contentId);
  return { contentId, ...state, listsUpdated };
}

/**
 * Called after an episode tick. Stores title info, clears the "whole series" flag when an episode
 * is un-ticked, and reports whether the series just became complete.
 */
async function afterEpisodeChange(uid, contentId, { watched, meta }) {
  const ref = watchedCol(uid).doc(contentId);
  const cleaned = cleanMeta(meta);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};

  const patch = { kind: 'series' };
  const known = { ...(data.meta || {}), ...cleaned };
  if (!known.totalEpisodes || totalsStale(known)) Object.assign(known, totalsToMeta(await lookupTotals(contentId)));
  if (Object.keys(known).length) patch.meta = known;
  if (!watched && data.watched) {
    patch.watched = false;
    patch.watchedAt = admin.firestore.FieldValue.delete();
    patch.completedBy = admin.firestore.FieldValue.delete();
  }
  await ref.set(patch, { merge: true });

  // Un-ticking an episode means the series is no longer fully watched: un-tick it in every watchlist too.
  if (!watched) await syncLists(uid, contentId, false).catch(() => 0);

  let fresh = await ref.get();
  // More episodes may have aired since this series was finished.
  if (await reopenIfGrown(uid, contentId, ref, fresh.data() || {})) fresh = await ref.get();
  let summary = summarize(contentId, fresh.data() || {});
  let justCompleted = false;
  if (watched && summary && summary.status === 'completed' && !fresh.data().watched) {
    // Every episode is ticked: record the series itself as watched, and tick it in any list.
    await ref.set({ watched: true, watchedAt: new Date().toISOString(), completedBy: 'episodes' }, { merge: true });
    await syncLists(uid, contentId, true).catch(() => 0);
    justCompleted = true;
    fresh = await ref.get();
    summary = summarize(contentId, fresh.data() || {});
  }
  const completed = !!summary && summary.status === 'completed';
  return { completed, justCompleted, summary };
}

/** A watchlist toggle also updates the title record, so both views agree. */
async function mirrorListToggle(uid, listName, ident, watched) {
  const snap = await listsCol(uid).doc(listName).get();
  if (!snap.exists) return null;
  const movies = Array.isArray(snap.data().movies) ? snap.data().movies : [];
  const idStr = String(ident);
  const item = movies.find((m) => String(m.imdbID || '') === idStr || String(m.tmdb_id || '') === idStr);
  if (!item) return null;
  const cid = contentIdFromItem(item);
  if (!cid) return null;

  const kind = kindFromType(item.media_type || item.Type);
  const ref = watchedCol(uid).doc(cid);
  const existing = await ref.get();
  const patch = {
    kind,
    watched: !!watched,
    // keep what is already stored (episode totals); the list item only refreshes title/poster/year
    meta: { ...((existing.exists && existing.data().meta) || {}), ...metaFromItem(item) },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  patch.watchedAt = watched ? new Date().toISOString() : admin.firestore.FieldValue.delete();
  // checked by hand in a list: stays finished. (unchecked: no longer finished at all)
  patch.completedBy = admin.firestore.FieldValue.delete();
  await ref.set(patch, { merge: true });

  // Un-checking a series that is only "finished" because every episode is ticked would otherwise do nothing:
  // clear those ticks. A series that is only partly watched keeps its progress.
  if (!watched && kind === 'series') {
    const fresh = await ref.get();
    const s = summarize(cid, fresh.data() || {});
    if (s && s.status === 'completed') {
      const clear = {};
      for (const [k] of episodeEntries(fresh.data())) clear[k] = admin.firestore.FieldValue.delete();
      await ref.set(clear, { merge: true });
    }
  }
  return { contentId: cid };
}

module.exports = {
  parseContentId,
  summarize,
  listWatchedTitles,
  getTitleState,
  setTitleWatched,
  afterEpisodeChange,
  mirrorListToggle,
  migrateFromWatchlists,
  MAX_BULK_EPISODES,
  setTotalsProvider,
};
