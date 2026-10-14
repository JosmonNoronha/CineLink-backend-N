// src/services/publicWatchlists/index.js
'use strict';

const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');
const { cacheGet, cacheSet } = require('../tmdb/cache');
const tmdbMovies = require('../tmdb/movies');
const tmdbTv = require('../tmdb/tv');

// ─── Collection helpers ───────────────────────────────────────────────────────

const db = () => getFirestore();

const listDoc = (id) => db().collection('publicWatchlists').doc(id);
const itemsCol = (id) => listDoc(id).collection('items');
const itemDoc = (id, key) => itemsCol(id).doc(String(key));
const likesCol = (id) => listDoc(id).collection('likes');
const followsCol = (id) => listDoc(id).collection('follows');

const ownerRefDoc = (uid, id) => db().collection('users').doc(uid).collection('publicWatchlistRefs').doc(id);
const followedRefDoc = (uid, id) => db().collection('users').doc(uid).collection('followedLists').doc(id);
const reportDoc = (listId, uid) => db().collection('publicWatchlistReports').doc(`${listId}_${uid}`);

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ITEMS_PER_LIST = 1000;
const MAX_LISTS_PER_USER = 50;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;
const FEED_CACHE_TTL_SECONDS = 60;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// ─── Pure helpers (exported for tests) ────────────────────────────────────────

const makeItemKey = (tmdbId, mediaType) => `${mediaType}:${tmdbId}`;

function serializeTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (ts._seconds) return new Date(ts._seconds * 1000).toISOString();
  return null;
}

/** Never expose an email (or anything email-shaped) as a public display name. */
function sanitizeOwnerName(name) {
  const clean = String(name || '')
    .trim()
    .slice(0, 40);
  if (!clean || clean.includes('@')) return 'Anonymous';
  return clean;
}

function normalizeTags(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const t = String(raw).toLowerCase().trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

function buildPosterUrl(posterPath) {
  return posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : null;
}

const encodeCursor = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('Invalid cursor', 400, 'VALIDATION_ERROR');
  }
}

const tsCursor = (ts) => ({ _seconds: ts._seconds, _nanoseconds: ts._nanoseconds });
const toTimestamp = (c) => {
  if (!c || !Number.isFinite(c._seconds) || !Number.isFinite(c._nanoseconds)) {
    throw new AppError('Invalid cursor', 400, 'VALIDATION_ERROR');
  }
  return new admin.firestore.Timestamp(c._seconds, c._nanoseconds);
};

const clampLimit = (limit) => Math.min(Math.max(Number(limit) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);

function serializeList(id, data) {
  return {
    id,
    name: data.name ?? '',
    description: data.description ?? '',
    ownerId: data.ownerId ?? '',
    ownerName: data.ownerName ?? '',
    coverPoster: data.coverPoster ?? null,
    previewPosters: data.previewPosters ?? (data.coverPoster ? [data.coverPoster] : []),
    tags: data.tags ?? [],
    itemCount: data.itemCount ?? 0,
    likeCount: Math.max(0, data.likeCount ?? 0),
    followCount: Math.max(0, data.followCount ?? 0),
    isPublic: true,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function serializeItem(id, data) {
  return {
    id,
    tmdb_id: data.tmdb_id ?? null,
    media_type: data.media_type ?? null,
    title: data.title ?? '',
    poster: data.poster ?? null,
    year: data.year ?? null,
    addedAt: serializeTimestamp(data.addedAt),
    addedBy: data.addedBy ?? null,
  };
}

async function requirePublicList(id) {
  const snap = await listDoc(id).get();
  if (!snap.exists || !snap.data().isPublic) {
    throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
  }
  return snap;
}

function assertOwner(snap, uid) {
  if (snap.data().ownerId !== uid) throw new AppError('Forbidden', 403, 'FORBIDDEN');
}

/**
 * Title/poster/year come from TMDB (cached), never from the client, so a user
 * can't store arbitrary text or image URLs in a public list.
 */
async function fetchTmdbSummary(tmdbId, mediaType) {
  let data;
  try {
    const res = mediaType === 'tv' ? await tmdbTv.details(tmdbId) : await tmdbMovies.details(tmdbId);
    data = res.data;
  } catch {
    throw new AppError('Title not found', 404, 'NOT_FOUND');
  }
  if (!data) throw new AppError('Title not found', 404, 'NOT_FOUND');
  return {
    title: String(data.title || data.name || '').slice(0, 200),
    poster: buildPosterUrl(data.poster_path),
    year: String(data.release_date || data.first_air_date || '').slice(0, 4) || null,
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

async function createPublicWatchlist(uid, { name, description = '', tags = [], ownerName = '' }) {
  const existing = await db().collection('users').doc(uid).collection('publicWatchlistRefs').count().get();

  if (existing.data().count >= MAX_LISTS_PER_USER) {
    throw new AppError(`Public watchlist limit reached (${MAX_LISTS_PER_USER})`, 413, 'RESOURCE_LIMIT');
  }

  const ref = db().collection('publicWatchlists').doc();
  const id = ref.id;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const cleanName = name.trim();

  const batch = db().batch();
  batch.create(ref, {
    name: cleanName,
    description: description.trim(),
    ownerId: uid,
    ownerName: sanitizeOwnerName(ownerName),
    coverPoster: null,
    previewPosters: [],
    tags: normalizeTags(tags),
    itemCount: 0,
    likeCount: 0,
    followCount: 0,
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(ownerRefDoc(uid, id), { name: cleanName, watchlistId: id, createdAt: now, updatedAt: now });
  await batch.commit();

  const snap = await ref.get();
  return serializeList(id, snap.data());
}

// ─── Read ─────────────────────────────────────────────────────────────────────

async function getPublicWatchlist(id, requestingUid = null) {
  const snap = await requirePublicList(id);
  const data = serializeList(id, snap.data());

  if (requestingUid) {
    const [likeSnap, followSnap] = await Promise.all([
      likesCol(id).doc(requestingUid).get(),
      followsCol(id).doc(requestingUid).get(),
    ]);
    data.viewerHasLiked = likeSnap.exists;
    data.viewerIsFollowing = followSnap.exists;
    data.viewerIsOwner = snap.data().ownerId === requestingUid;
  }
  return data;
}

async function getPublicWatchlistItems(id, { limit = PAGE_SIZE_DEFAULT, cursor = null } = {}) {
  await requirePublicList(id);
  const safeLimit = clampLimit(limit);

  let query = itemsCol(id)
    .orderBy('addedAt', 'desc')
    .limit(safeLimit + 1);
  if (cursor) query = query.startAfter(toTimestamp(decodeCursor(cursor)));

  const docs = (await query.get()).docs;
  const hasMore = docs.length > safeLimit;
  const items = docs.slice(0, safeLimit).map((d) => serializeItem(d.id, d.data()));
  const nextCursor = hasMore ? encodeCursor(tsCursor(docs[safeLimit - 1].data().addedAt)) : null;

  return { items, hasMore, nextCursor };
}

// ─── Discover ─────────────────────────────────────────────────────────────────

async function discoverPublicWatchlists({
  sort = 'popular',
  tag = null,
  limit = PAGE_SIZE_DEFAULT,
  cursor = null,
  requestingUid = null,
} = {}) {
  const safeLimit = clampLimit(limit);
  const cleanTag = tag ? String(tag).toLowerCase().trim() : null;
  const cacheKey = `pubwl:discover:${sort}:${cleanTag || '-'}:${safeLimit}:${cursor || '-'}`;

  // The list page itself is the same for everyone, so cache it briefly.
  // Viewer-specific flags are always computed fresh below.
  let page = null;
  try {
    page = await cacheGet(cacheKey);
  } catch {
    page = null;
  }

  if (!page) {
    let query = db().collection('publicWatchlists').where('isPublic', '==', true);
    if (cleanTag) query = query.where('tags', 'array-contains', cleanTag);

    query =
      sort === 'popular'
        ? query.orderBy('likeCount', 'desc').orderBy('createdAt', 'desc')
        : query.orderBy('createdAt', 'desc');
    query = query.limit(safeLimit + 1);

    if (cursor) {
      const c = decodeCursor(cursor);
      const ts = toTimestamp(c.createdAt);
      query = sort === 'popular' ? query.startAfter(Number(c.likeCount) || 0, ts) : query.startAfter(ts);
    }

    const docs = (await query.get()).docs;
    const hasMore = docs.length > safeLimit;
    const lists = docs.slice(0, safeLimit).map((d) => serializeList(d.id, d.data()));
    const last = hasMore ? docs[safeLimit - 1].data() : null;

    page = {
      lists,
      hasMore,
      nextCursor: last
        ? encodeCursor({ likeCount: last.likeCount ?? 0, createdAt: tsCursor(last.createdAt) })
        : null,
    };
    try {
      await cacheSet(cacheKey, page, FEED_CACHE_TTL_SECONDS);
    } catch {
      /* cache is best-effort */
    }
  }

  const lists = page.lists.map((l) => ({ ...l }));

  if (requestingUid && lists.length) {
    // One batched RPC per kind instead of one read per list.
    const [likeSnaps, followSnaps] = await Promise.all([
      db().getAll(...lists.map((l) => likesCol(l.id).doc(requestingUid))),
      db().getAll(...lists.map((l) => followsCol(l.id).doc(requestingUid))),
    ]);
    lists.forEach((l, i) => {
      l.viewerHasLiked = likeSnaps[i].exists;
      l.viewerIsFollowing = followSnaps[i].exists;
      l.viewerIsOwner = l.ownerId === requestingUid;
    });
  }

  return { lists, hasMore: page.hasMore, nextCursor: page.nextCursor };
}

async function listFromRefs(refDocs, decorate) {
  const snaps = await db().getAll(...refDocs.map((r) => listDoc(r.id)));
  const lists = snaps
    .filter((s) => s.exists && s.data().isPublic)
    .map((s) => decorate(serializeList(s.id, s.data()), s));
  return lists;
}

async function getUserPublicWatchlists(uid, { limit = PAGE_SIZE_DEFAULT, cursor = null } = {}) {
  const safeLimit = clampLimit(limit);
  let query = db()
    .collection('users')
    .doc(uid)
    .collection('publicWatchlistRefs')
    .orderBy('createdAt', 'desc')
    .limit(safeLimit + 1);
  if (cursor) query = query.startAfter(toTimestamp(decodeCursor(cursor)));

  const refDocs = (await query.get()).docs;
  const hasMore = refDocs.length > safeLimit;
  const refs = refDocs.slice(0, safeLimit);

  const lists = refs.length ? await listFromRefs(refs, (l) => ({ ...l, viewerIsOwner: true })) : [];
  const nextCursor = hasMore ? encodeCursor(tsCursor(refs[safeLimit - 1].data().createdAt)) : null;
  return { lists, hasMore, nextCursor };
}

async function getFollowedWatchlists(uid, { limit = PAGE_SIZE_DEFAULT, cursor = null } = {}) {
  const safeLimit = clampLimit(limit);
  let query = db()
    .collection('users')
    .doc(uid)
    .collection('followedLists')
    .orderBy('followedAt', 'desc')
    .limit(safeLimit + 1);
  if (cursor) query = query.startAfter(toTimestamp(decodeCursor(cursor)));

  const refDocs = (await query.get()).docs;
  const hasMore = refDocs.length > safeLimit;
  const refs = refDocs.slice(0, safeLimit);

  const lists = refs.length
    ? await listFromRefs(refs, (l, s) => ({
        ...l,
        viewerIsFollowing: true,
        viewerIsOwner: s.data().ownerId === uid,
      }))
    : [];
  const nextCursor = hasMore ? encodeCursor(tsCursor(refs[safeLimit - 1].data().followedAt)) : null;
  return { lists, hasMore, nextCursor };
}

// ─── Items ────────────────────────────────────────────────────────────────────

async function addItemToPublicWatchlist(uid, listId, { tmdb_id, media_type }) {
  const tmdbKey = makeItemKey(tmdb_id, media_type);

  // Cheap checks first so we don't hit TMDB for forbidden/duplicate requests.
  const preSnap = await requirePublicList(listId);
  assertOwner(preSnap, uid);
  const preItem = await itemDoc(listId, tmdbKey).get();
  if (preItem.exists) return { added: false, item: serializeItem(tmdbKey, preItem.data()) };

  const summary = await fetchTmdbSummary(tmdb_id, media_type);

  return db().runTransaction(async (tx) => {
    const ref = listDoc(listId);
    const iRef = itemDoc(listId, tmdbKey);
    const [listSnap, itemSnap] = await Promise.all([tx.get(ref), tx.get(iRef)]);

    if (!listSnap.exists || !listSnap.data().isPublic) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }
    assertOwner(listSnap, uid);
    if (itemSnap.exists) return { added: false, item: serializeItem(tmdbKey, itemSnap.data()) };
    if ((listSnap.data().itemCount ?? 0) >= MAX_ITEMS_PER_LIST) {
      throw new AppError(`Item limit reached (${MAX_ITEMS_PER_LIST})`, 413, 'RESOURCE_LIMIT');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(iRef, {
      tmdb_id: Number(tmdb_id),
      media_type,
      title: summary.title,
      poster: summary.poster,
      year: summary.year,
      addedAt: now,
      addedBy: uid,
    });
    const prevPosters = listSnap.data().previewPosters ?? [];
    const nextPosters = summary.poster
      ? [summary.poster, ...prevPosters.filter((p) => p !== summary.poster)].slice(0, 4)
      : prevPosters;
    tx.update(ref, {
      itemCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
      previewPosters: nextPosters,
      ...(!listSnap.data().coverPoster && summary.poster ? { coverPoster: summary.poster } : {}),
    });
    tx.set(ownerRefDoc(uid, listId), { updatedAt: now }, { merge: true });

    return {
      added: true,
      item: serializeItem(tmdbKey, { tmdb_id: Number(tmdb_id), media_type, ...summary, addedBy: uid }),
    };
  });
}

async function removeItemFromPublicWatchlist(uid, listId, tmdbKey) {
  const removedPoster = await db().runTransaction(async (tx) => {
    const ref = listDoc(listId);
    const iRef = itemDoc(listId, tmdbKey);
    const [listSnap, itemSnap] = await Promise.all([tx.get(ref), tx.get(iRef)]);

    if (!listSnap.exists || !listSnap.data().isPublic) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }
    assertOwner(listSnap, uid);
    if (!itemSnap.exists) return undefined;

    tx.delete(iRef);
    tx.update(ref, {
      itemCount: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return itemSnap.data().poster ?? null;
  });

  if (removedPoster === undefined) return { removed: false };

    // Refresh cover + preview posters from the newest remaining items.
  const recent = await itemsCol(listId).orderBy('addedAt', 'desc').limit(4).get();
  const posters = recent.docs.map((d) => d.data().poster).filter(Boolean);
  await listDoc(listId).update({
    previewPosters: posters,
    coverPoster: posters[0] ?? null,
  });
  return { removed: true };
}

// ─── Like / follow (transactional, can't double count or go negative) ────────

async function toggleLike(uid, listId) {
  return db().runTransaction(async (tx) => {
    const ref = listDoc(listId);
    const likeRef = likesCol(listId).doc(uid);
    const [listSnap, likeSnap] = await Promise.all([tx.get(ref), tx.get(likeRef)]);

    if (!listSnap.exists || !listSnap.data().isPublic) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }
    if (listSnap.data().ownerId === uid) {
      throw new AppError('Cannot like your own watchlist', 400, 'VALIDATION_ERROR');
    }

    if (likeSnap.exists) {
      tx.delete(likeRef);
      tx.update(ref, { likeCount: admin.firestore.FieldValue.increment(-1) });
      return { liked: false };
    }
    tx.set(likeRef, { uid, likedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(ref, { likeCount: admin.firestore.FieldValue.increment(1) });
    return { liked: true };
  });
}

async function toggleFollow(uid, listId) {
  return db().runTransaction(async (tx) => {
    const ref = listDoc(listId);
    const followRef = followsCol(listId).doc(uid);
    const [listSnap, followSnap] = await Promise.all([tx.get(ref), tx.get(followRef)]);

    if (!listSnap.exists || !listSnap.data().isPublic) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }

    // The list's follow doc and the user's own index doc change together.
    if (followSnap.exists) {
      tx.delete(followRef);
      tx.delete(followedRefDoc(uid, listId));
      tx.update(ref, { followCount: admin.firestore.FieldValue.increment(-1) });
      return { following: false };
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(followRef, { uid, followedAt: now });
    tx.set(followedRefDoc(uid, listId), { watchlistId: listId, followedAt: now });
    tx.update(ref, { followCount: admin.firestore.FieldValue.increment(1) });
    return { following: true };
  });
}

// ─── Update / delete ──────────────────────────────────────────────────────────

async function updatePublicWatchlist(uid, listId, { name, description, tags }) {
  const ref = listDoc(listId);
  const snap = await requirePublicList(listId);
  assertOwner(snap, uid);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const patch = { updatedAt: now };
  if (name !== undefined) patch.name = String(name).trim();
  if (description !== undefined) patch.description = String(description).trim();
  if (tags !== undefined) patch.tags = normalizeTags(tags);

  const batch = db().batch();
  batch.update(ref, patch);
  if (name !== undefined)
    batch.set(ownerRefDoc(uid, listId), { name: patch.name, updatedAt: now }, { merge: true });
  await batch.commit();

  return serializeList(listId, (await ref.get()).data());
}

async function deleteInBatches(colRef, onDoc, batchSize = 200) {
  let snap = await colRef.limit(batchSize).get();
  while (!snap.empty) {
    const batch = db().batch();
    snap.docs.forEach((d) => {
      batch.delete(d.ref);
      if (onDoc) onDoc(d, batch);
    });
    await batch.commit();
    snap = await colRef.limit(batchSize).get();
  }
}

async function deletePublicWatchlist(uid, listId) {
  const ref = listDoc(listId);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: true };
  assertOwner(snap, uid);

  // Remove the list first so it 404s immediately; then clean up children.
  // If cleanup is interrupted the leftovers are unreachable orphans, not a
  // visible half-empty list.
  const batch = db().batch();
  batch.delete(ref);
  batch.delete(ownerRefDoc(uid, listId));
  await batch.commit();

  await deleteInBatches(followsCol(listId), (d, b) => b.delete(followedRefDoc(d.id, listId)));
  await deleteInBatches(itemsCol(listId));
  await deleteInBatches(likesCol(listId));

  return { deleted: true };
}

// ─── Membership (which of MY public lists contain this title) ────────────────

async function getMembership(uid, tmdbKey) {
  const refs = await db()
    .collection('users')
    .doc(uid)
    .collection('publicWatchlistRefs')
    .limit(MAX_LISTS_PER_USER)
    .get();
  if (refs.empty) return { listIds: [] };

  // One batched read for all of the user's lists.
  const snaps = await db().getAll(...refs.docs.map((r) => itemDoc(r.id, tmdbKey)));
  return { listIds: snaps.filter((s) => s.exists).map((s) => s.ref.parent.parent.id) };
}

// ─── Moderation ───────────────────────────────────────────────────────────────

const REPORT_REASONS = ['spam', 'offensive', 'copyright', 'other'];

async function reportPublicWatchlist(uid, listId, { reason, note = '' }) {
  const snap = await requirePublicList(listId);
  if (snap.data().ownerId === uid) {
    throw new AppError('Cannot report your own watchlist', 400, 'VALIDATION_ERROR');
  }
  // Deterministic id => one report per user per list.
  await reportDoc(listId, uid).set({
    watchlistId: listId,
    reporterId: uid,
    reason,
    note: String(note).trim().slice(0, 300),
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { reported: true };
}

/**
 * Takedown: flips isPublic to false, which removes the list from every query
 * and every 404-guarded read without touching any index.
 */
async function takedownPublicWatchlist(listId, moderatorUid) {
  const ref = listDoc(listId);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
  await ref.update({
    isPublic: false,
    takedownBy: moderatorUid,
    takedownAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { takenDown: true };
}

module.exports = {
  createPublicWatchlist,
  getPublicWatchlist,
  getPublicWatchlistItems,
  discoverPublicWatchlists,
  getUserPublicWatchlists,
  getFollowedWatchlists,
  addItemToPublicWatchlist,
  removeItemFromPublicWatchlist,
  toggleLike,
  toggleFollow,
  updatePublicWatchlist,
  deletePublicWatchlist,
  reportPublicWatchlist,
  takedownPublicWatchlist,
  getMembership,
  REPORT_REASONS,
  _internal: {
    sanitizeOwnerName,
    normalizeTags,
    buildPosterUrl,
    encodeCursor,
    decodeCursor,
    makeItemKey,
    serializeList,
  },
};
