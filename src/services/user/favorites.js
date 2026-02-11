const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');

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
  const favorites = data.userFavorites || [];

  return Array.isArray(favorites) ? favorites : [];
}

async function addFavorite(uid, item) {
  const ref = userDocRef(uid);
  await ref.set(
    {
      userFavorites: admin.firestore.FieldValue.arrayUnion(item),
    },
    { merge: true }
  );
  const snap = await ref.get();
  return snap.data()?.userFavorites || [];
}

async function addFavoriteLegacy(uid, movie) {
  const ref = userDocRef(uid);
  await ref.set(
    {
      userFavorites: admin.firestore.FieldValue.arrayUnion(movie),
    },
    { merge: true }
  );
  const snap = await ref.get();
  return snap.data()?.userFavorites || [];
}

async function removeFavorite(uid, imdbID) {
  const ref = userDocRef(uid);
  const doc = await ref.get();
  if (!doc.exists) return { removed: false };

  const favorites = doc.data()?.userFavorites || [];
  const movieToRemove = favorites.find((m) => m.imdbID === imdbID);

  if (movieToRemove) {
    await ref.update({
      userFavorites: admin.firestore.FieldValue.arrayRemove(movieToRemove),
    });
    return { removed: true };
  }

  return { removed: false };
}

async function removeFavoriteLegacy(uid, imdbID) {
  return removeFavorite(uid, imdbID);
}

module.exports = { listFavorites, addFavorite, addFavoriteLegacy, removeFavorite, removeFavoriteLegacy };
