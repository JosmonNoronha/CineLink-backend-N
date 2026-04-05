const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');

function watchedDocRef(uid, contentId) {
  return getFirestore().collection('users').doc(uid).collection('watched').doc(String(contentId));
}

function makeEpisodeKey(season, episode) {
  return `s${Number(season)}e${Number(episode)}`;
}

async function setEpisodeWatched(uid, contentId, season, episode, watched) {
  const ref = watchedDocRef(uid, contentId);
  const key = makeEpisodeKey(season, episode);

  if (watched) {
    await ref.set(
      {
        [key]: {
          watchedAt: new Date().toISOString(),
          season: Number(season),
          episode: Number(episode),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    await ref.set(
      {
        [key]: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const snap = await ref.get();
  return snap.exists ? snap.data() : {};
}

async function getWatchedEpisodes(uid, contentId) {
  const snap = await watchedDocRef(uid, contentId).get();
  if (!snap.exists) return {};

  const data = snap.data() || {};
  const result = {};

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('s') && value && typeof value === 'object') {
      result[key] = value;
    }
  }

  return result;
}

module.exports = {
  setEpisodeWatched,
  getWatchedEpisodes,
};
