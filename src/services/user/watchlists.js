const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');

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
      movies: data.movies || data.items || [], // Support both field names
    });
  });

  const sorted = items.sort((a, b) => {
    const aTime = a.createdAt?._seconds || 0;
    const bTime = b.createdAt?._seconds || 0;
    return bTime - aTime;
  });

  return sorted;
}

async function createWatchlist(uid, { name, description }) {
  const ref = watchlistsCollection(uid).doc(name);
  const existing = await ref.get();
  if (existing.exists) throw new AppError('Watchlist already exists', 409, 'CONFLICT');

  await ref.set({
    movies: [], // Use "movies" field to match original structure
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

  const current = snap.data();
  const items = Array.isArray(current.movies) ? current.movies : [];

  if (items.some((i) => i.tmdb_id === item.tmdb_id && i.media_type === item.media_type)) {
    return { added: false };
  }

  const newItem = {
    ...item,
    watched: false,
    addedAt: admin.firestore.Timestamp.now(), // Cannot use serverTimestamp() inside arrays
  };

  await ref.set(
    {
      movies: [...items, newItem],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { added: true };
}

async function addMovieLegacy(uid, name, movie) {
  const ref = watchlistsCollection(uid).doc(name);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

  const current = snap.data();
  const items = Array.isArray(current.movies) ? current.movies : [];

  if (items.some((i) => String(i.imdbID) === String(movie.imdbID))) {
    return { added: false };
  }

  const newItem = {
    imdbID: movie.imdbID,
    title: movie.Title || null,
    poster: movie.Poster || null,
    watched: false,
    addedAt: admin.firestore.Timestamp.now(), // Cannot use serverTimestamp() inside arrays
    metadata: movie,
  };

  await ref.set(
    {
      movies: [...items, newItem],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { added: true };
}

async function toggleWatchedLegacy(uid, name, imdbID) {
  const ref = watchlistsCollection(uid).doc(name);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

  const items = Array.isArray(snap.data().movies) ? snap.data().movies : [];
  const idx = items.findIndex((i) => String(i.imdbID) === String(imdbID));
  if (idx === -1) throw new AppError('Item not found in watchlist', 404, 'NOT_FOUND');

  const oldItem = items[idx];
  const updatedItem = {
    ...oldItem,
    watched: !oldItem.watched,
    watchedAt: !oldItem.watched ? admin.firestore.Timestamp.now() : null, // Cannot use serverTimestamp() inside arrays
  };
  const nextItems = [...items];
  nextItems[idx] = updatedItem;

  await ref.set(
    {
      movies: nextItems,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { watched: updatedItem.watched };
}

async function removeItem(uid, name, tmdbId) {
  const ref = watchlistsCollection(uid).doc(name);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

  const items = Array.isArray(snap.data().movies) ? snap.data().movies : [];
  const nextItems = items.filter((i) => String(i.tmdb_id) !== String(tmdbId));

  await ref.set(
    {
      movies: nextItems,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { removed: true };
}

async function removeMovieLegacy(uid, name, imdbID) {
  const ref = watchlistsCollection(uid).doc(name);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

  const items = Array.isArray(snap.data().movies) ? snap.data().movies : [];
  const nextItems = items.filter((i) => String(i.imdbID) !== String(imdbID));

  await ref.set(
    {
      movies: nextItems,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { removed: true };
}

async function toggleWatched(uid, name, tmdbId) {
  const ref = watchlistsCollection(uid).doc(name);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError('Watchlist not found', 404, 'NOT_FOUND');

  const items = Array.isArray(snap.data().movies) ? snap.data().movies : [];
  const idx = items.findIndex((i) => String(i.tmdb_id) === String(tmdbId));
  if (idx === -1) throw new AppError('Item not found in watchlist', 404, 'NOT_FOUND');

  const oldItem = items[idx];
  const updatedItem = {
    ...oldItem,
    watched: !oldItem.watched,
    watchedAt: !oldItem.watched ? admin.firestore.Timestamp.now() : null, // Cannot use serverTimestamp() inside arrays
  };

  const nextItems = [...items];
  nextItems[idx] = updatedItem;

  await ref.set(
    {
      movies: nextItems,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { watched: updatedItem.watched };
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
};
