const { getFirestore } = require('../../config/firebase');
const { normalizeMediaItem, isSameMedia, parseLegacyImdbId } = require('./mediaIdentity');

// Favorites are stored in the user document as an array field, NOT a subcollection
function userDocRef(uid) {
  return getFirestore().collection('users').doc(uid);
}

async function listFavorites(uid) {
  // Favorites stored as array field "userFavorites" in user doc
  const doc = await userDocRef(uid).get();

  if (!doc.exists) {
    return [];
  }

  const data = doc.data();
  const favorites = Array.isArray(data.userFavorites) ? data.userFavorites : [];
  return favorites.map((item) => normalizeMediaItem(item));
}

async function addFavorite(uid, item) {
  const ref = userDocRef(uid);
  const snap = await ref.get();
  const current = snap.exists && Array.isArray(snap.data()?.userFavorites) ? snap.data().userFavorites : [];

  const normalized = normalizeMediaItem(item);
  if (!normalized.id.key) return current.map((entry) => normalizeMediaItem(entry));

  const mapped = current.map((entry) => normalizeMediaItem(entry));
  if (mapped.some((entry) => isSameMedia(entry, normalized))) {
    return mapped;
  }

  mapped.push(normalized);
  await ref.set({ userFavorites: mapped }, { merge: true });
  return mapped;
}

async function addFavoriteLegacy(uid, movie) {
  return addFavorite(uid, movie);
}

async function removeFavorite(uid, imdbID) {
  const ref = userDocRef(uid);
  const doc = await ref.get();
  if (!doc.exists) return { removed: false };

  const target = normalizeMediaItem({ imdbID });
  const parsed = parseLegacyImdbId(imdbID);
  const favorites = Array.isArray(doc.data()?.userFavorites) ? doc.data().userFavorites : [];
  const mapped = favorites.map((entry) => normalizeMediaItem(entry));
  const next = mapped.filter((entry) => {
    if (isSameMedia(entry, target)) return false;
    if (parsed.key && entry.id && entry.id.key === parsed.key) return false;
    return true;
  });

  if (next.length !== mapped.length) {
    await ref.set({ userFavorites: next }, { merge: true });
    return { removed: true };
  }

  return { removed: false };
}

async function removeFavoriteLegacy(uid, imdbID) {
  return removeFavorite(uid, imdbID);
}

module.exports = { listFavorites, addFavorite, addFavoriteLegacy, removeFavorite, removeFavoriteLegacy };
