require('express-async-errors');

const request = require('supertest');
const express = require('express');
const { createFakeFirestore } = require('./helpers/fakeFirestoreModeration');

const mockFake = createFakeFirestore();

jest.mock('firebase-admin', () => ({
  firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'TS'), increment: jest.fn((n) => ({ inc: n })) } },
}));
jest.mock('../src/config/firebase', () => ({ getFirestore: () => mockFake, getAuth: () => ({ verifyIdToken: async () => ({}) }) }));
jest.mock('../src/config/environment', () => ({ env: { AUTO_HIDE_REPORT_THRESHOLD: 3 } }));
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => {
  const { AppError } = require('../src/utils/errors');
  return {
    optionalAuth: (_req, _res, next) => next(),
    authMiddleware: (req, _res, next) => {
      const role = req.headers['x-test-role'];
      req.headers.authorization = 'Bearer test-token'; // rbac re-checks privileged tokens
      if (!role) return next(new AppError('Missing Authorization bearer token', 401, 'UNAUTHORIZED'));
      const perms = {
        user: ['user:read', 'user:write'],
        moderator: ['user:read', 'user:write', 'content:moderate'],
        admin: ['user:read', 'user:write', 'content:moderate', 'admin:all'],
      }[role];
      req.user = { uid: `${role}-1`, permissions: perms };
      return next();
    },
  };
});

const svc = require('../src/services/moderation');
const moderationRouter = require('../src/routes/moderation');
const { errorHandler } = require('../src/middleware/errorHandler');

const LIST = 'publicWatchlists/L1';
const listData = { name: 'Bad list', description: 'd', ownerId: 'owner', isPublic: true, itemCount: 0 };

describe('moderation service', () => {
  beforeEach(() => {
    mockFake._clear(); // fresh data for each test
    mockFake._put('publicWatchlists/L1', listData);
  });

  const exists = (path) => mockFake._get(path) !== undefined;

  test('a report creates a queue entry and does not hide below the threshold', async () => {
    const r = await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam', note: ' hi ' });
    expect(r).toEqual({ reported: true, autoHidden: false });
    expect(mockFake._get('publicWatchlistReports/L1_u1')).toMatchObject({ status: 'open', reason: 'spam', note: 'hi' });
    expect(mockFake._get('publicWatchlistModeration/L1')).toMatchObject({ status: 'open', openReportCount: 1, reasons: { spam: 1 } });
    expect(mockFake._get(LIST).isPublic).toBe(true);
  });

  test('the same user cannot add a second open report', async () => {
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    const again = await svc.reportPublicWatchlist('u1', 'L1', { reason: 'offensive' });
    expect(again.alreadyReported).toBe(true);
    expect(mockFake._get('publicWatchlistModeration/L1').openReportCount).toBe(1);
  });

  test('owners cannot report their own list; hidden or missing lists 404', async () => {
    await expect(svc.reportPublicWatchlist('owner', 'L1', { reason: 'spam' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.reportPublicWatchlist('u1', 'nope', { reason: 'spam' })).rejects.toMatchObject({ statusCode: 404 });
    mockFake._put(LIST, { ...listData, isPublic: false });
    await expect(svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('3 distinct reporters auto-hide the list and write an audit entry', async () => {
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    await svc.reportPublicWatchlist('u2', 'L1', { reason: 'spam' });
    const third = await svc.reportPublicWatchlist('u3', 'L1', { reason: 'offensive' });
    expect(third.autoHidden).toBe(true);
    expect(mockFake._get(LIST)).toMatchObject({ isPublic: false, moderation: { status: 'auto_hidden', by: 'system' } });
    const audit = mockFake._all('moderationAuditLog/');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'auto_hide', actorType: 'system', reportCount: 3 });
  });

  test('queue is sorted by report count and shows visibility', async () => {
    mockFake._put('publicWatchlists/L2', { ...listData, name: 'Other' });
    await svc.reportPublicWatchlist('u1', 'L2', { reason: 'other' });
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    await svc.reportPublicWatchlist('u2', 'L1', { reason: 'spam' });
    const { items, total } = await svc.listQueue({ limit: 10 });
    expect(total).toBe(2);
    expect(items.map((i) => i.watchlistId)).toEqual(['L1', 'L2']);
    expect(items[0]).toMatchObject({ openReportCount: 2, topReason: 'spam', visibility: 'visible', name: 'Bad list' });
  });

  test('takedown hides the list, actions the reports, closes the queue entry and audits', async () => {
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    const out = await svc.applyDecision('L1', 'mod-1', { decision: 'takedown', reason: 'spam', note: 'obvious' });
    expect(out).toMatchObject({ visibility: 'taken_down', reportsResolved: 1, reportsRemaining: 0 });
    expect(mockFake._get(LIST)).toMatchObject({ isPublic: false, moderation: { status: 'taken_down', by: 'mod-1' }, takedownBy: 'mod-1' });
    expect(mockFake._get('publicWatchlistReports/L1_u1').status).toBe('actioned');
    expect(mockFake._get('publicWatchlistModeration/L1').status).toBe('resolved');
    expect(mockFake._all('moderationAuditLog/')[0]).toMatchObject({ action: 'takedown', actorId: 'mod-1', reason: 'spam', note: 'obvious' });
    expect((await svc.listQueue()).items).toHaveLength(0);
  });

  test('takedown on an already hidden list is a 409', async () => {
    mockFake._put(LIST, { ...listData, isPublic: false });
    await expect(svc.applyDecision('L1', 'm', { decision: 'takedown', reason: 'spam' })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('restore brings the list back and dismisses its reports', async () => {
    for (const u of ['u1', 'u2', 'u3']) await svc.reportPublicWatchlist(u, 'L1', { reason: 'spam' });
    expect(mockFake._get(LIST).isPublic).toBe(false);
    const out = await svc.applyDecision('L1', 'mod-1', { decision: 'restore', note: 'false positive' });
    expect(out).toMatchObject({ visibility: 'visible', reportsResolved: 3 });
    expect(mockFake._get(LIST)).toMatchObject({ isPublic: true, moderation: { status: 'visible' } });
    expect(mockFake._get('publicWatchlistReports/L1_u2').status).toBe('dismissed');
    // reports no longer count toward a new auto-hide
    const r = await svc.reportPublicWatchlist('u9', 'L1', { reason: 'spam' });
    expect(r.autoHidden).toBe(false);
    expect(mockFake._get('publicWatchlistModeration/L1').openReportCount).toBe(1);
  });

  test('restore on a visible list is a 409', async () => {
    await expect(svc.applyDecision('L1', 'm', { decision: 'restore' })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('dismiss restores an auto-hidden list but leaves a manual takedown hidden', async () => {
    for (const u of ['u1', 'u2', 'u3']) await svc.reportPublicWatchlist(u, 'L1', { reason: 'spam' });
    const out = await svc.applyDecision('L1', 'm', { decision: 'dismiss' });
    expect(out.visibility).toBe('visible');
    expect(mockFake._get(LIST).isPublic).toBe(true);

    // manual takedown, then a late report would 404, so seed an open report directly
    mockFake._put(LIST, { ...listData, isPublic: false, moderation: { status: 'taken_down' } });
    mockFake._put('publicWatchlistReports/L1_late', { watchlistId: 'L1', reporterId: 'late', status: 'open', reason: 'spam' });
    const out2 = await svc.applyDecision('L1', 'm', { decision: 'dismiss' });
    expect(out2.visibility).toBe('taken_down');
    expect(mockFake._get(LIST).isPublic).toBe(false);
  });

  test('dismiss with nothing open is a 404', async () => {
    await expect(svc.applyDecision('L1', 'm', { decision: 'dismiss' })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('re-reporting is allowed after a report was resolved', async () => {
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    await svc.applyDecision('L1', 'm', { decision: 'dismiss' });
    const r = await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    expect(r.alreadyReported).toBeUndefined();
    expect(mockFake._get('publicWatchlistReports/L1_u1').status).toBe('open');
  });

  test('detail returns list content, reports and history', async () => {
    mockFake._put('publicWatchlists/L1/items/movie:1', { title: 'A Movie', media_type: 'movie', year: 1999 });
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'offensive', note: 'rude' });
    await svc.applyDecision('L1', 'mod-1', { decision: 'takedown', reason: 'offensive' });
    const d = await svc.getReportDetail('L1');
    expect(d.visibility).toBe('taken_down');
    expect(d.list.items[0].title).toBe('A Movie');
    expect(d.reports[0]).toMatchObject({ reason: 'offensive', status: 'actioned' });
    expect(d.history[0].action).toBe('takedown');
    await expect(svc.getReportDetail('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('pure helpers', () => {
    const h = svc._internal;
    expect(h.visibilityOf(null)).toBe('deleted');
    expect(h.visibilityOf({ isPublic: true })).toBe('visible');
    expect(h.visibilityOf({ isPublic: false })).toBe('taken_down');
    expect(h.visibilityOf({ isPublic: false, moderation: { status: 'auto_hidden' } })).toBe('auto_hidden');
    expect(h.topReason({ spam: 1, offensive: 4 })).toBe('offensive');
    expect(h.toIso({ _seconds: 0 })).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('moderation routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/moderation', moderationRouter);
  app.use(errorHandler);

  beforeEach(() => {
    mockFake._all('').forEach(({ path }) => mockFake._put(path, undefined));
    mockFake._put('publicWatchlists/L1', listData);
  });

  test('anonymous gets 401, normal users get 403', async () => {
    await request(app).get('/api/admin/moderation/queue').expect(401);
    await request(app).get('/api/admin/moderation/queue').set('x-test-role', 'user').expect(403);
    await request(app).post('/api/admin/moderation/lists/L1/takedown').set('x-test-role', 'user').send({ reason: 'spam' }).expect(403);
  });

  test('moderator can list, view, take down and restore', async () => {
    await svc.reportPublicWatchlist('u1', 'L1', { reason: 'spam' });
    const q = await request(app).get('/api/admin/moderation/queue').set('x-test-role', 'moderator').expect(200);
    expect(JSON.stringify(q.body)).toContain('L1');
    await request(app).get('/api/admin/moderation/lists/L1').set('x-test-role', 'moderator').expect(200);
    await request(app).post('/api/admin/moderation/lists/L1/takedown').set('x-test-role', 'moderator').send({ reason: 'spam', note: 'x' }).expect(200);
    await request(app).post('/api/admin/moderation/lists/L1/takedown').set('x-test-role', 'moderator').send({ reason: 'spam' }).expect(409);
    await request(app).post('/api/admin/moderation/lists/L1/restore').set('x-test-role', 'moderator').send({}).expect(200);
  });

  test('validation: takedown needs a valid reason; limit is bounded', async () => {
    await request(app).post('/api/admin/moderation/lists/L1/takedown').set('x-test-role', 'moderator').send({}).expect(400);
    await request(app).post('/api/admin/moderation/lists/L1/takedown').set('x-test-role', 'moderator').send({ reason: 'bogus' }).expect(400);
    await request(app).get('/api/admin/moderation/queue?limit=999').set('x-test-role', 'moderator').expect(400);
  });

  test('audit log is admin only', async () => {
    await request(app).get('/api/admin/moderation/audit').set('x-test-role', 'moderator').expect(403);
    await request(app).get('/api/admin/moderation/audit').set('x-test-role', 'admin').expect(200);
  });
});
