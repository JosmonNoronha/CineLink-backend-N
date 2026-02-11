const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');

async function getProfile(uid) {
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    // Create the user document if it doesn't exist
    const newProfile = {
      uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(newProfile, { merge: true });
    // Fetch the document again to get server-generated timestamps
    const newSnap = await ref.get();
    return newSnap.data();
  }
  return snap.data();
}

async function upsertProfile(uid, patch) {
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);
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
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().streamingSubscriptions) {
    return [];
  }
  return snap.data().streamingSubscriptions || [];
}

async function updateSubscriptions(uid, subscriptions) {
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);
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

module.exports = { getProfile, upsertProfile, getSubscriptions, updateSubscriptions };
