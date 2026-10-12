const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');
const { normalizeMediaItem, isSameMedia, parseLegacyImdbId } = require('./mediaIdentity');

const MAX_WATCHLIST_ITEMS = 500;

function watchlistsCollection(uid) {
  return getFirestore().collection('users').doc(uid).collection('watchlists');
}

async function listWatchlists(uid) {
  // Don't use orderBy - documents without createdAt field are excluded!
  const snap = await watchlistsCollection(uid).limit(200).get();

  const items = [];
  snap.docs.forEach((d) => {
    const data = d.data();
    items.push({
      id: d.id,
      name: d.id,
      ...data,
      movies: (data.movies || data.items || []).map((movie) => normalizeMediaItem(movie)), // Support both field names
    });
  });

  const sorted = items.sort((a, b) => {
    const aTime = a.createdAt?._seconds || 0;
    const bTime = b.createdAt?._seconds || 0;
    return bTime - aTime;
  });

  return sorted;
}

async function createWatchlist(uid, { name, description: _description }) {
  const ref = watchlistsCollection(uid).doc(name);
  await getFirestore().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) throw new AppError('Watchlist already exists', 409, 'CONFLICT');

    tx.create(ref, {
      movies: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  const snap = await ref.get();
  return { id: snap.id, name: snap.id, ...snap.data() };
}

async function getWatchlist(uid, name) {
  const ref = watchlistsCollection(uid).doc(name);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
  return { id: snap.id, ...snap.data() };
}

async function deleteWatchlist(uid, name) {
  await watchlistsCollection(uid).doc(name).delete();
  return { removed: true };
}

async function addItem(uid, name, item) {
  const ref = watchlistsCollection(uid).doc(name);
  const normalized = normalizeMediaItem(item);
  if (!normalized.id.key) {
    throw new AppError('Invalid media identity', 400, 'VALIDATION_ERROR');
  }

  let result = { added: false };
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

    const current = snap.data();
    const items = (Array.isArray(current.movies) ? current.movies : []).map((entry) => normalizeMediaItem(entry));
    if (items.some((i) => isSameMedia(i, normalized))) return;
    if (items.length >= MAX_WATCHLIST_ITEMS) {
      throw new AppError(`Watchlist item limit reached (${MAX_WATCHLIST_ITEMS})`, 413, 'RESOURCE_LIMIT');
    }

    tx.set(
      ref,
      {
        movies: [
          ...items,
          {
            ...normalized,
            watched: false,
            addedAt: admin.firestore.Timestamp.now(),
          },
        ],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    result = { added: true };
  });
  return result;
}

async function addMovieLegacy(uid, name, movie) {
  return addItem(uid, name, movie);
}

async function toggleWatchedLegacy(uid, name, imdbID) {
  const ref = watchlistsCollection(uid).doc(name);
  let result;
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

    const items = (Array.isArray(snap.data().movies) ? snap.data().movies : []).map((entry) => normalizeMediaItem(entry));
    const target = normalizeMediaItem({ imdbID });
    const parsed = parseLegacyImdbId(imdbID);
    const idx = items.findIndex((i) => {
      if (isSameMedia(i, target)) return true;
      if (parsed.key && i.id && i.id.key === parsed.key) return true;
      return String(i.imdbID) === String(imdbID);
    });
    if (idx === -1) throw new AppError('Item not found in watchlist', 404, 'NOT_FOUND');

    const oldItem = items[idx];
    const updatedItem = {
      ...oldItem,
      watched: !oldItem.watched,
      watchedAt: !oldItem.watched ? admin.firestore.Timestamp.now() : null,
    };
    const nextItems = [...items];
    nextItems[idx] = updatedItem;
    tx.set(ref, {
      movies: nextItems,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    result = { watched: updatedItem.watched };
  });
  return result;
}

async function removeItem(uid, name, tmdbId) {
  const ref = watchlistsCollection(uid).doc(name);
  let result = { removed: false };
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

    const items = (Array.isArray(snap.data().movies) ? snap.data().movies : []).map((entry) => normalizeMediaItem(entry));
    const nextItems = items.filter((i) => String(i.tmdb_id) !== String(tmdbId));
    if (nextItems.length === items.length) return;

    tx.set(
      ref,
      {
        movies: nextItems,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    result = { removed: true };
  });
  return result;
}

async function removeMovieLegacy(uid, name, imdbID) {
  const ref = watchlistsCollection(uid).doc(name);
  let result = { removed: false };
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

    const items = (Array.isArray(snap.data().movies) ? snap.data().movies : []).map((entry) => normalizeMediaItem(entry));
    const target = normalizeMediaItem({ imdbID });
    const parsed = parseLegacyImdbId(imdbID);
    const nextItems = items.filter((i) => {
      if (isSameMedia(i, target)) return false;
      if (parsed.key && i.id && i.id.key === parsed.key) return false;
      return String(i.imdbID) !== String(imdbID);
    });
    if (nextItems.length === items.length) return;

    tx.set(ref, {
      movies: nextItems,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    result = { removed: true };
  });
  return result;
}

async function toggleWatched(uid, name, tmdbId) {
  const ref = watchlistsCollection(uid).doc(name);
  let result;
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

    const items = (Array.isArray(snap.data().movies) ? snap.data().movies : []).map((entry) => normalizeMediaItem(entry));
    const idx = items.findIndex((i) => String(i.tmdb_id) === String(tmdbId));
    if (idx === -1) throw new AppError('Item not found in watchlist', 404, 'NOT_FOUND');

    const oldItem = items[idx];
    const updatedItem = {
      ...oldItem,
      watched: !oldItem.watched,
      watchedAt: !oldItem.watched ? admin.firestore.Timestamp.now() : null,
    };
    const nextItems = [...items];
    nextItems[idx] = updatedItem;

    tx.set(
      ref,
      {
        movies: nextItems,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    result = { watched: updatedItem.watched };
  });
  return result;
}

module.exports = {
  listWatchlists,
  createWatchlist,
  getWatchlist,
  deleteWatchlist,
  addItem,
  addMovieLegacy,
  removeItem,
  removeMovieLegacy,
  toggleWatched,
  toggleWatchedLegacy,
  MAX_WATCHLIST_ITEMS,
};
