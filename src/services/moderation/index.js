// src/services/moderation/index.js
'use strict';

/*
  Moderation for public watchlists.

  Collections
    publicWatchlistReports/{listId_reporterUid}   one report per user per list
        status: open | actioned | dismissed
    publicWatchlistModeration/{listId}            the review queue: one doc per reported list
        status: open | resolved, openReportCount, reasons{}, first/lastReportAt
    moderationAuditLog/{autoId}                   append-only record of every decision
    publicWatchlists/{listId}.moderation          { status: visible|auto_hidden|taken_down, reason, by, at }
        (hiding still works by flipping isPublic, so every existing public query keeps working)

  Every state change (report, auto-hide, takedown, restore, dismiss) and its audit
  entry are written in one Firestore transaction.
*/

const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { env } = require('../../config/environment');
const { AppError } = require('../../utils/errors');

const db = () => getFirestore();
const listDoc = (id) => db().collection('publicWatchlists').doc(id);
const reportDoc = (listId, uid) => db().collection('publicWatchlistReports').doc(`${listId}_${uid}`);
const reportsCol = () => db().collection('publicWatchlistReports');
const queueDoc = (listId) => db().collection('publicWatchlistModeration').doc(listId);
const queueCol = () => db().collection('publicWatchlistModeration');
const auditCol = () => db().collection('moderationAuditLog');

const REPORT_REASONS = ['spam', 'offensive', 'copyright', 'other'];
const DECISIONS = ['takedown', 'restore', 'dismiss'];
const QUEUE_SCAN_LIMIT = 200; // open lists read per queue request
const MAX_REPORTS_PER_ACTION = 400; // keeps one transaction under Firestore's 500-write cap
const now = () => admin.firestore.FieldValue.serverTimestamp();

// ─── Pure helpers (exported for tests) ────────────────────────────────────────

function toIso(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

function visibilityOf(listData) {
  if (!listData) return 'deleted';
  if (listData.isPublic) return 'visible';
  return listData.moderation?.status || 'taken_down'; // legacy takedowns have no moderation field
}

function topReason(reasons = {}) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : null;
}

function serializeQueueEntry(q, listData) {
  return {
    watchlistId: q.watchlistId,
    name: listData?.name ?? q.listName ?? '',
    ownerId: listData?.ownerId ?? q.ownerId ?? '',
    openReportCount: q.openReportCount ?? 0,
    reasons: q.reasons ?? {},
    topReason: topReason(q.reasons),
    visibility: visibilityOf(listData),
    firstReportAt: toIso(q.firstReportAt),
    lastReportAt: toIso(q.lastReportAt),
  };
}

const compareQueue = (a, b) =>
  b.openReportCount - a.openReportCount || (b.lastReportAt || '').localeCompare(a.lastReportAt || '');

// ─── Reporting (user-facing) ──────────────────────────────────────────────────

async function reportPublicWatchlist(uid, listId, { reason, note = '' }) {
  const threshold = env.AUTO_HIDE_REPORT_THRESHOLD;

  return db().runTransaction(async (tx) => {
    const [listSnap, reportSnap, queueSnap] = await Promise.all([
      tx.get(listDoc(listId)),
      tx.get(reportDoc(listId, uid)),
      tx.get(queueDoc(listId)),
    ]);

    if (!listSnap.exists || !listSnap.data().isPublic) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }
    const list = listSnap.data();
    if (list.ownerId === uid) {
      throw new AppError('Cannot report your own watchlist', 400, 'VALIDATION_ERROR');
    }
    if (reportSnap.exists && reportSnap.data().status === 'open') {
      return { reported: true, alreadyReported: true };
    }

    const q = queueSnap.exists && queueSnap.data().status === 'open' ? queueSnap.data() : null;
    const count = (q?.openReportCount || 0) + 1;
    const reasons = { ...(q?.reasons || {}) };
    reasons[reason] = (reasons[reason] || 0) + 1;

    tx.set(reportDoc(listId, uid), {
      watchlistId: listId,
      reporterId: uid,
      reason,
      note: String(note).trim().slice(0, 300),
      status: 'open',
      createdAt: now(),
    });
    tx.set(queueDoc(listId), {
      watchlistId: listId,
      listName: list.name ?? '',
      ownerId: list.ownerId ?? '',
      status: 'open',
      openReportCount: count,
      reasons,
      firstReportAt: q?.firstReportAt ?? now(),
      lastReportAt: now(),
    });

    let autoHidden = false;
    if (threshold > 0 && count >= threshold) {
      autoHidden = true;
      tx.update(listDoc(listId), {
        isPublic: false,
        moderation: { status: 'auto_hidden', reason: 'report_threshold', by: 'system', at: now() },
      });
      tx.set(auditCol().doc(), {
        action: 'auto_hide',
        watchlistId: listId,
        actorId: 'system',
        actorType: 'system',
        reason: 'report_threshold',
        note: `${count} open reports (threshold ${threshold})`,
        reportCount: count,
        createdAt: now(),
      });
    }
    return { reported: true, autoHidden };
  });
}

// ─── Review queue (moderators) ────────────────────────────────────────────────

async function listQueue({ limit = 50 } = {}) {
  const snap = await queueCol().where('status', '==', 'open').limit(QUEUE_SCAN_LIMIT).get();
  const queued = snap.docs.map((d) => d.data());
  if (!queued.length) return { items: [], total: 0 };

  const listSnaps = await db().getAll(...queued.map((q) => listDoc(q.watchlistId)));
  const byId = new Map(listSnaps.map((s) => [s.id, s.exists ? s.data() : null]));

  const items = queued
    .map((q) => serializeQueueEntry(q, byId.get(q.watchlistId)))
    .sort(compareQueue);
  return { items: items.slice(0, limit), total: items.length };
}

async function getReportDetail(listId) {
  const [listSnap, queueSnap, reportsSnap, auditSnap, itemsSnap] = await Promise.all([
    listDoc(listId).get(),
    queueDoc(listId).get(),
    reportsCol().where('watchlistId', '==', listId).limit(100).get(),
    auditCol().where('watchlistId', '==', listId).limit(50).get(),
    listDoc(listId).collection('items').limit(12).get(),
  ]);
  if (!listSnap.exists && !queueSnap.exists && reportsSnap.empty) {
    throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
  }

  const list = listSnap.exists ? listSnap.data() : null;
  const byNewest = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');

  return {
    watchlistId: listId,
    visibility: visibilityOf(list),
    list: list && {
      name: list.name ?? '',
      description: list.description ?? '',
      ownerId: list.ownerId ?? '',
      ownerName: list.ownerName ?? '',
      tags: list.tags ?? [],
      itemCount: list.itemCount ?? 0,
      previewPosters: list.previewPosters ?? [],
      moderation: list.moderation
        ? { ...list.moderation, at: toIso(list.moderation.at) }
        : null,
      items: itemsSnap.docs.map((d) => {
        const i = d.data();
        return { title: i.title ?? '', media_type: i.media_type ?? null, year: i.year ?? null, poster: i.poster ?? null };
      }),
    },
    queue: queueSnap.exists ? serializeQueueEntry(queueSnap.data(), list) : null,
    reports: reportsSnap.docs
      .map((d) => {
        const r = d.data();
        return {
          reporterId: r.reporterId,
          reason: r.reason,
          note: r.note ?? '',
          status: r.status,
          createdAt: toIso(r.createdAt),
          resolvedAt: toIso(r.resolvedAt),
        };
      })
      .sort(byNewest),
    history: auditSnap.docs.map((d) => serializeAudit(d.id, d.data())).sort(byNewest),
  };
}

function serializeAudit(id, a) {
  return {
    id,
    action: a.action,
    watchlistId: a.watchlistId,
    actorId: a.actorId,
    actorType: a.actorType,
    reason: a.reason ?? null,
    note: a.note ?? '',
    reportCount: a.reportCount ?? 0,
    createdAt: toIso(a.createdAt),
  };
}

async function getAuditLog({ limit = 50 } = {}) {
  const snap = await auditCol().orderBy('createdAt', 'desc').limit(limit).get();
  return { items: snap.docs.map((d) => serializeAudit(d.id, d.data())) };
}

// ─── Decisions (moderators) ───────────────────────────────────────────────────

/**
 * decision:
 *   takedown  hide the list, mark its open reports "actioned"
 *   restore   show a hidden list again, mark its open reports "dismissed"
 *   dismiss   reports were wrong: mark them "dismissed" (an auto-hidden list comes back,
 *             a manually taken-down one stays hidden until restored)
 */
async function applyDecision(listId, moderatorUid, { decision, reason = null, note = '' }) {
  if (!DECISIONS.includes(decision)) throw new AppError('Invalid decision', 400, 'VALIDATION_ERROR');
  const cleanNote = String(note).trim().slice(0, 500);

  return db().runTransaction(async (tx) => {
    const openReports = reportsCol()
      .where('watchlistId', '==', listId)
      .where('status', '==', 'open')
      .limit(MAX_REPORTS_PER_ACTION);

    const [listSnap, queueSnap, reportsSnap] = await Promise.all([
      tx.get(listDoc(listId)),
      tx.get(queueDoc(listId)),
      tx.get(openReports),
    ]);

    const list = listSnap.exists ? listSnap.data() : null;
    const visibility = visibilityOf(list);

    if ((decision === 'takedown' || decision === 'restore') && !list) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }
    if (decision === 'takedown' && visibility !== 'visible') {
      throw new AppError('Watchlist is already hidden', 409, 'CONFLICT');
    }
    if (decision === 'restore' && visibility === 'visible') {
      throw new AppError('Watchlist is already visible', 409, 'CONFLICT');
    }
    if (decision === 'dismiss' && reportsSnap.empty) {
      throw new AppError('No open reports for this watchlist', 404, 'NOT_FOUND');
    }

    const reportStatus = decision === 'takedown' ? 'actioned' : 'dismissed';
    reportsSnap.docs.forEach((d) =>
      tx.update(d.ref, { status: reportStatus, resolvedAt: now(), resolvedBy: moderatorUid }),
    );

    // The queue entry closes unless more open reports remain beyond this batch.
    const totalOpen = queueSnap.exists ? queueSnap.data().openReportCount || 0 : reportsSnap.size;
    const remaining = Math.max(0, totalOpen - reportsSnap.size);
    if (queueSnap.exists) {
      tx.update(queueDoc(listId), remaining > 0
        ? { openReportCount: remaining }
        : { status: 'resolved', openReportCount: 0, resolvedAt: now(), resolvedBy: moderatorUid });
    }

    let outcome = visibility;
    if (decision === 'takedown') {
      tx.update(listDoc(listId), {
        isPublic: false,
        moderation: { status: 'taken_down', reason, by: moderatorUid, at: now() },
        takedownBy: moderatorUid,
        takedownAt: now(),
      });
      outcome = 'taken_down';
    } else if (decision === 'restore' || (decision === 'dismiss' && visibility === 'auto_hidden')) {
      tx.update(listDoc(listId), {
        isPublic: true,
        moderation: { status: 'visible', reason: null, by: moderatorUid, at: now() },
      });
      outcome = 'visible';
    }

    tx.set(auditCol().doc(), {
      action: decision,
      watchlistId: listId,
      actorId: moderatorUid,
      actorType: 'moderator',
      reason,
      note: cleanNote,
      reportCount: reportsSnap.size,
      createdAt: now(),
    });

    return { watchlistId: listId, decision, visibility: outcome, reportsResolved: reportsSnap.size, reportsRemaining: remaining };
  });
}

module.exports = {
  reportPublicWatchlist,
  listQueue,
  getReportDetail,
  getAuditLog,
  applyDecision,
  REPORT_REASONS,
  DECISIONS,
  _internal: { toIso, visibilityOf, topReason, serializeQueueEntry, compareQueue },
};
