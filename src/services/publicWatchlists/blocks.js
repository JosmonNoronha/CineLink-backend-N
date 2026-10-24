'use strict';

/*
  "Block this user": the blocker stops seeing that person's public lists anywhere
  (discover, saved lists, opening a list directly).

  Stored per blocker at users/{uid}/blockedUsers/{blockedUid}. Only the blocker can see their own
  list. Deleting an account deletes it too (it sits under users/{uid}).
*/

const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');
const { logger } = require('../../utils/logger');

const MAX_BLOCKED = 200;
const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_USERS = 2000;

const cache = new Map(); // uid -> { ids: Set<string>, expires }

const col = (uid) => getFirestore().collection('users').doc(uid).collection('blockedUsers');

const cleanName = (name) => {
  const n = String(name || '').trim().slice(0, 40);
  return !n || n.includes('@') ? 'Anonymous' : n;
};

const forget = (uid) => cache.delete(uid);

/**
 * Set of user ids this viewer has blocked. If Firestore cannot be read, returns an empty set for
 * this call (and does not remember it) rather than breaking every list screen.
 */
async function getBlockedIds(uid) {
  if (!uid) return new Set();
  const hit = cache.get(uid);
  if (hit && hit.expires > Date.now()) return hit.ids;

  try {
    const snap = await col(uid).limit(MAX_BLOCKED).get();
    const ids = new Set(snap.docs.map((d) => d.id));
    if (cache.size >= CACHE_MAX_USERS) cache.clear();
    cache.set(uid, { ids, expires: Date.now() + CACHE_TTL_MS });
    return ids;
  } catch (error) {
    logger.warn('Could not read blocked users', { error: error.message });
    return new Set();
  }
}

async function blockUser(uid, targetId, name = '') {
  if (targetId === uid) {
    throw new AppError('You cannot block yourself', 400, 'VALIDATION_ERROR', undefined, {
      userMessage: "You can't block yourself.",
    });
  }

  const ref = col(uid).doc(targetId);
  const existing = await ref.get();
  if (existing.exists) return { blocked: true };

  const all = await col(uid).limit(MAX_BLOCKED).get();
  if (all.size >= MAX_BLOCKED) {
    throw new AppError(`Block limit reached (${MAX_BLOCKED})`, 413, 'RESOURCE_LIMIT', undefined, {
      userMessage: "You've reached the limit of blocked users.",
    });
  }

  await ref.set({ blockedAt: admin.firestore.FieldValue.serverTimestamp(), name: cleanName(name) });
  forget(uid);
  return { blocked: true };
}

async function unblockUser(uid, targetId) {
  await col(uid).doc(targetId).delete();
  forget(uid);
  return { blocked: false };
}

async function listBlocked(uid) {
  const snap = await col(uid).limit(MAX_BLOCKED).get();
  const users = snap.docs.map((d) => {
    const data = d.data();
    const at = data.blockedAt;
    return {
      userId: d.id,
      name: data.name || 'Anonymous',
      blockedAt: at && typeof at.toDate === 'function' ? at.toDate().toISOString() : null,
    };
  });
  users.sort((a, b) => String(b.blockedAt).localeCompare(String(a.blockedAt)));
  return { users };
}

function _resetCacheForTests() {
  cache.clear();
}

module.exports = { getBlockedIds, blockUser, unblockUser, listBlocked, MAX_BLOCKED, _resetCacheForTests };
