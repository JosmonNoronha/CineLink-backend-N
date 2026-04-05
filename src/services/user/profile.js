const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');

function userDocRef(uid) {
  return getFirestore().collection('users').doc(uid);
}

async function ensureProfile(uid, identity = {}) {
  const ref = userDocRef(uid);
  const snap = await ref.get();
  if (snap.exists) return snap.data();

  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(
    {
      uid,
      identity: {
        email: identity.email || null,
        name: identity.name || null,
        picture: identity.picture || null,
      },
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
  const created = await ref.get();
  return created.data();
}

async function getProfile(uid) {
  return ensureProfile(uid);
}

async function upsertProfile(uid, patch) {
  const ref = userDocRef(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(
    {
      ...patch,
      uid,
      updatedAt: now,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const snap = await ref.get();
  return snap.data();
}

async function getSubscriptions(uid) {
  const ref = userDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().streamingSubscriptions) {
    return [];
  }
  return snap.data().streamingSubscriptions || [];
}

async function updateSubscriptions(uid, subscriptions) {
  const ref = userDocRef(uid);
  await ref.set(
    {
      streamingSubscriptions: subscriptions,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const snap = await ref.get();
  return snap.data();
}

async function getGamification(uid) {
  const snap = await userDocRef(uid).get();
  if (!snap.exists || !snap.data().gamification) return null;
  return snap.data().gamification;
}

async function updateGamification(uid, data) {
  const { syncedAt: _ignored, ...cleanData } = data;
  const ref = userDocRef(uid);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data().gamification || {}) : {};

  const takeLater = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);

  const merged = {
    xp: Math.max(existing.xp || 0, cleanData.xp || 0),
    totalWatched: Math.max(existing.totalWatched || 0, cleanData.totalWatched || 0),
    listsCreated: Math.max(existing.listsCreated || 0, cleanData.listsCreated || 0),
    listsCompleted: Math.max(existing.listsCompleted || 0, cleanData.listsCompleted || 0),
    currentStreak: Math.max(existing.currentStreak || 0, cleanData.currentStreak || 0),
    bestStreak: Math.max(existing.bestStreak || 0, cleanData.bestStreak || 0),
    lastWatchDate: takeLater(existing.lastWatchDate, cleanData.lastWatchDate),
    unlockedAchievements: [...new Set([...(existing.unlockedAchievements || []), ...(cleanData.unlockedAchievements || [])])],
    watchedMovieIds: [...new Set([...(existing.watchedMovieIds || []), ...(cleanData.watchedMovieIds || [])])],
    completedListNames: [...new Set([...(existing.completedListNames || []), ...(cleanData.completedListNames || [])])],
    dailyWatchCounts: { ...(existing.dailyWatchCounts || {}), ...(cleanData.dailyWatchCounts || {}) },
    weeklyWatchCounts: { ...(existing.weeklyWatchCounts || {}), ...(cleanData.weeklyWatchCounts || {}) },
  };
  merged.totalWatched = Math.max(merged.totalWatched, merged.watchedMovieIds.length);

  await ref.set(
    { gamification: { ...merged, syncedAt: admin.firestore.FieldValue.serverTimestamp() }, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

module.exports = {
  ensureProfile,
  getProfile,
  upsertProfile,
  getSubscriptions,
  updateSubscriptions,
  getGamification,
  updateGamification,
};
