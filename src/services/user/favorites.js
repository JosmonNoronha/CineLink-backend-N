const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');
const { normalizeMediaItem, isSameMedia, parseLegacyImdbId } = require('./mediaIdentity');

const MAX_FAVORITES = 500;

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
  const normalized = normalizeMediaItem(item);
  if (!normalized.id.key) return [];

  let result = [];
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists && Array.isArray(snap.data()?.userFavorites) ? snap.data().userFavorites : [];
    const mapped = current.map((entry) => normalizeMediaItem(entry));

    if (mapped.some((entry) => isSameMedia(entry, normalized))) {
      result = mapped;
      return;
    }

    if (mapped.length >= MAX_FAVORITES) {
      throw new AppError(`Favorites limit reached (${MAX_FAVORITES})`, 413, 'RESOURCE_LIMIT');
    }

    mapped.push(normalized);
    tx.set(ref, { userFavorites: mapped }, { merge: true });
    result = mapped;
  });
  return result;
}

async function addFavoriteLegacy(uid, movie) {
  return addFavorite(uid, movie);
}

async function removeFavorite(uid, imdbID) {
  const ref = userDocRef(uid);
  let result = { removed: false };
  await getFirestore().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return;

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
      tx.set(ref, { userFavorites: next }, { merge: true });
      result = { removed: true };
    }
  });
  return result;
}

async function removeFavoriteLegacy(uid, imdbID) {
  return removeFavorite(uid, imdbID);
}

module.exports = {
  MAX_FAVORITES,
  listFavorites,
  addFavorite,
  addFavoriteLegacy,
  removeFavorite,
  removeFavoriteLegacy,
};
