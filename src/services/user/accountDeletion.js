'use strict';

/*
  Delete a user's account and everything tied to them.

  Every step can be repeated safely, and the Firebase login is removed LAST. If something fails
  halfway, the user still has a working login and can simply try again.

  What happens, in order:
    1. A small record is kept: accountDeletions/{uid} (uid and timestamps only).
    2. The user's public watchlists are deleted (items, likes, follows, and each follower's link),
       along with the reports and review-queue entry about them.
    3. Lists the user follows lose that follower.
    4. Likes the user gave are removed and the like counts corrected.
    5. Reports the user filed stay for moderators, but are made anonymous.
    6. The user's whole private data tree users/{uid} (profile, watchlists, favorites, progress,
       gamification, ...) is deleted, including every sub-collection.
    7. Cached copies are dropped.
    8. The Firebase Authentication account is deleted.

  The moderation audit log is kept on purpose: it holds list ids and moderator ids, not the
  deleted user's personal data.
*/

const crypto = require('crypto');
const admin = require('firebase-admin');
const { getFirestore, getAuth } = require('../../config/firebase');
const { logger } = require('../../utils/logger');
const { AppError } = require('../../utils/errors');
const publicLists = require('../publicWatchlists');

const db = () => getFirestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();
const inc = (n) => admin.firestore.FieldValue.increment(n);

const LISTS_PER_PAGE = 25;
const FOLLOWS_PER_PAGE = 100;
const LIKES_PER_PAGE = 50;
const REPORTS_PER_PAGE = 200;
const BATCH_PER_PAGE = 400; // stays under Firestore's 500-write batch limit
const MAX_ROUNDS = 400; // no loop can run forever

const tombstone = (uid) => db().collection('accountDeletions').doc(uid);

const isMissingIndex = (e) =>
  e && (e.code === 9 || /FAILED_PRECONDITION|requires? .*index/i.test(String(e.message || '')));

// ─── Steps ────────────────────────────────────────────────────────────────────

/** Remove the reports and review-queue entry for a list that no longer exists. */
async function clearModerationFor(listId) {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const snap = await db()
      .collection('publicWatchlistReports')
      .where('watchlistId', '==', listId)
      .limit(BATCH_PER_PAGE)
      .get();
    if (snap.empty) break;
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db().collection('publicWatchlistModeration').doc(listId).delete();
}

async function deleteOwnedLists(uid) {
  let deleted = 0;
  const seen = new Set();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const snap = await db().collection('publicWatchlists').where('ownerId', '==', uid).limit(LISTS_PER_PAGE).get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (seen.has(d.id)) throw new Error(`List ${d.id} could not be deleted`); // no progress: stop, do not spin
      seen.add(d.id);
      await publicLists.deletePublicWatchlist(uid, d.id);
      await clearModerationFor(d.id);
      deleted += 1;
    }
  }
  return deleted;
}

async function unfollowAll(uid) {
  let removed = 0;
  const followed = () => db().collection('users').doc(uid).collection('followedLists');
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const snap = await followed().limit(FOLLOWS_PER_PAGE).get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const listRef = db().collection('publicWatchlists').doc(d.id);
      const followRef = listRef.collection('follows').doc(uid);
      await db().runTransaction(async (tx) => {
        const [listSnap, followSnap] = await Promise.all([tx.get(listRef), tx.get(followRef)]);
        if (followSnap.exists) {
          tx.delete(followRef);
          if (listSnap.exists) tx.update(listRef, { followCount: inc(-1) });
        }
        tx.delete(d.ref);
      });
      removed += 1;
    }
  }
  return removed;
}

async function removeLikes(uid) {
  let removed = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const snap = await db().collectionGroup('likes').where('uid', '==', uid).limit(LIKES_PER_PAGE).get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        await db().runTransaction(async (tx) => {
          const listRef = d.ref.parent.parent;
          const [likeSnap, listSnap] = await Promise.all([tx.get(d.ref), tx.get(listRef)]);
          if (!likeSnap.exists) return;
          tx.delete(d.ref);
          if (listSnap.exists) tx.update(listRef, { likeCount: inc(-1) });
        });
        removed += 1;
      }
    }
  } catch (e) {
    if (!isMissingIndex(e)) throw e;
    // Deleting the account must not be blocked by a missing index. The leftover like documents
    // only hold the user's id; add the index (see GUIDE.md) to have them removed too.
    logger.warn('Account deletion: likes index missing, like documents were left in place', { error: e.message });
    return { removed, skipped: true };
  }
  return { removed, skipped: false };
}

/** Keep reports for moderators but drop who filed them. */
async function anonymizeReports(uid) {
  let count = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const snap = await db().collection('publicWatchlistReports').where('reporterId', '==', uid).limit(REPORTS_PER_PAGE).get();
    if (snap.empty) break;
    const batch = db().batch();
    snap.docs.forEach((d) => {
      const r = d.data();
      const anonId = `${r.watchlistId}_deleted-${crypto.randomUUID()}`;
      batch.set(db().collection('publicWatchlistReports').doc(anonId), { ...r, reporterId: 'deleted-user', note: '' });
      batch.delete(d.ref);
    });
    await batch.commit();
    count += snap.size;
  }
  return count;
}

async function deleteUserTree(uid) {
  await db().recursiveDelete(db().collection('users').doc(uid));
}

async function dropCaches(uid) {
  try {
    // Present when the per-user read cache is installed; harmless when it is not.
    // eslint-disable-next-line global-require
    const cache = require('./userDataCache');
    await cache.invalidate(uid, 'watchlists', 'favorites');
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') logger.warn('Account deletion: cache invalidation failed', { error: e.message });
  }
}

async function deleteLogin(uid) {
  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') return;
    throw e;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function deleteAccount(uid) {
  if (!uid || typeof uid !== 'string') throw new AppError('Invalid user', 400, 'VALIDATION_ERROR');

  const first = !(await tombstone(uid).get()).exists;
  await tombstone(uid).set(
    { status: 'in_progress', updatedAt: now(), attempts: inc(1), ...(first ? { startedAt: now() } : {}) },
    { merge: true },
  );

  const summary = {};
  let step = 'start';
  try {
    step = 'public-lists';
    summary.publicListsDeleted = await deleteOwnedLists(uid);
    step = 'follows';
    summary.followsRemoved = await unfollowAll(uid);
    step = 'likes';
    const likes = await removeLikes(uid);
    summary.likesRemoved = likes.removed;
    if (likes.skipped) summary.warnings = ['likes-index-missing'];
    step = 'reports';
    summary.reportsAnonymized = await anonymizeReports(uid);
    step = 'user-data';
    await deleteUserTree(uid);
    step = 'caches';
    await dropCaches(uid);
    step = 'login';
    await deleteLogin(uid);
  } catch (error) {
    logger.error('Account deletion failed', { uid, step, error: error.message });
    await tombstone(uid)
      .set({ status: 'failed', failedStep: step, lastError: String(error.message).slice(0, 300), updatedAt: now() }, { merge: true })
      .catch(() => {});
    throw new AppError('Account deletion failed', 500, 'ACCOUNT_DELETION_FAILED', undefined, {
      userMessage: "We couldn't finish deleting your account. Please try again.",
      retryable: true,
    });
  }

  await tombstone(uid).set({ status: 'completed', completedAt: now(), updatedAt: now() }, { merge: true });
  logger.info('Account deleted', { uid, ...summary });
  return summary;
}

module.exports = { deleteAccount };
