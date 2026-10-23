require('express-async-errors');
const request = require('supertest');
const express = require('express');
const { createFakeFirestore } = require('./helpers/fakeFirestoreFull');

const mockFake = createFakeFirestore();
const mockDeleteUser = jest.fn();
const mockMarkDeleted = jest.fn();

jest.mock('firebase-admin', () => ({
  firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'TS'), increment: jest.fn((n) => ({ inc: n })) } },
}));
jest.mock('../src/config/firebase', () => ({
  getFirestore: () => mockFake,
  getAuth: () => ({ deleteUser: mockDeleteUser }),
}));
jest.mock('../src/config/environment', () => ({ env: {} }));
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { uid: 'u1', claims: { auth_time: Number(req.headers['x-auth-time']) } };
    next();
  },
  markUserDeleted: (...a) => mockMarkDeleted(...a),
}));
jest.mock('../src/middleware/rateLimiter', () => ({
  gamificationActionLimiter: (_q, _s, n) => n(),
  accountDeletionLimiter: (_q, _s, n) => n(),
}));
jest.mock('../src/services/user/profile', () => ({ ensureProfile: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/user/favorites', () => ({}));
jest.mock('../src/services/user/watchlists', () => ({}));
jest.mock('../src/services/user/episodes', () => ({}));
jest.mock('../src/services/user/gamification', () => ({}));

const { deleteAccount } = require('../src/services/user/accountDeletion');
const { requireRecentLogin } = require('../src/middleware/recentLogin');
const { errorHandler } = require('../src/middleware/errorHandler');

const seed = () => {
  mockFake._clear();
  // The user's own private data
  mockFake._put('users/u1', { displayName: 'Me' });
  mockFake._put('users/u1/watched/a', { x: 1 });
  mockFake._put('users/u1/watchlists/w/items/i', { x: 1 });
  mockFake._put('users/u1/publicWatchlistRefs/OWN', { x: 1 });
  mockFake._put('users/u1/followedLists/OTHER', { x: 1 });
  // A list the user owns, with a follower and a like from someone else
  mockFake._put('publicWatchlists/OWN', { ownerId: 'u1', followCount: 1, likeCount: 1 });
  mockFake._put('publicWatchlists/OWN/items/i', { t: 1 });
  mockFake._put('publicWatchlists/OWN/likes/u2', { uid: 'u2' });
  mockFake._put('publicWatchlists/OWN/follows/u2', { uid: 'u2' });
  mockFake._put('users/u2/followedLists/OWN', { x: 1 });
  mockFake._put('publicWatchlistModeration/OWN', { n: 1 });
  mockFake._put('publicWatchlistReports/OWN_u3', { watchlistId: 'OWN', reporterId: 'u3' });
  // Someone else's list the user follows, likes and reported
  mockFake._put('publicWatchlists/OTHER', { ownerId: 'u2', followCount: 3, likeCount: 5 });
  mockFake._put('publicWatchlists/OTHER/follows/u1', { uid: 'u1' });
  mockFake._put('publicWatchlists/OTHER/likes/u1', { uid: 'u1' });
  mockFake._put('publicWatchlists/OTHER/likes/u9', { uid: 'u9' });
  mockFake._put('publicWatchlistReports/OTHER_u1', { watchlistId: 'OTHER', reporterId: 'u1', note: 'private note' });
  mockFake._put('publicWatchlistModeration/OTHER', { n: 1 });
  mockFake._put('moderationAuditLog/a1', { action: 'x' });
};

beforeEach(() => {
  seed();
  mockDeleteUser.mockReset().mockResolvedValue();
  mockMarkDeleted.mockReset().mockResolvedValue();
});

describe('deleteAccount', () => {
  test('removes private data, owned lists and their children', async () => {
    const out = await deleteAccount('u1');
    expect(mockFake._paths('users/u1')).toEqual([]);
    expect(mockFake._paths('publicWatchlists/OWN')).toEqual([]);
    expect(mockFake._get('users/u2/followedLists/OWN')).toBeUndefined(); // follower's link gone
    expect(mockFake._get('publicWatchlistModeration/OWN')).toBeUndefined();
    expect(mockFake._get('publicWatchlistReports/OWN_u3')).toBeUndefined();
    expect(out.publicListsDeleted).toBe(1);
    expect(mockDeleteUser).toHaveBeenCalledWith('u1');
  });

  test('un-follows and un-likes other lists and fixes the counts', async () => {
    await deleteAccount('u1');
    expect(mockFake._get('publicWatchlists/OTHER/follows/u1')).toBeUndefined();
    expect(mockFake._get('publicWatchlists/OTHER/likes/u1')).toBeUndefined();
    expect(mockFake._get('publicWatchlists/OTHER/likes/u9')).toBeDefined(); // other people's likes untouched
    expect(mockFake._get('publicWatchlists/OTHER')).toMatchObject({ followCount: 2, likeCount: 4 });
  });

  test('keeps reports for moderators but makes them anonymous', async () => {
    await deleteAccount('u1');
    expect(mockFake._get('publicWatchlistReports/OTHER_u1')).toBeUndefined();
    const left = mockFake._paths('publicWatchlistReports/OTHER_');
    expect(left).toHaveLength(1);
    expect(mockFake._get(left[0])).toMatchObject({ reporterId: 'deleted-user', note: '' });
    expect(mockFake._get('publicWatchlistModeration/OTHER')).toBeDefined();
  });

  test('keeps the audit log and records a completed tombstone without personal data', async () => {
    await deleteAccount('u1');
    expect(mockFake._get('moderationAuditLog/a1')).toBeDefined();
    expect(mockFake._get('accountDeletions/u1')).toMatchObject({ status: 'completed' });
    expect(Object.keys(mockFake._get('accountDeletions/u1')).sort()).toEqual(
      ['attempts', 'completedAt', 'startedAt', 'status', 'updatedAt'].sort(),
    );
  });

  test('the login is deleted last: a failure earlier leaves it in place and can be retried', async () => {
    const spy = jest.spyOn(mockFake, 'recursiveDelete').mockRejectedValueOnce(new Error('boom'));
    await expect(deleteAccount('u1')).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_FAILED', statusCode: 500 });
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockFake._get('accountDeletions/u1')).toMatchObject({ status: 'failed', failedStep: 'user-data' });
    spy.mockRestore();
    await deleteAccount('u1'); // second try finishes
    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockFake._get('accountDeletions/u1')).toMatchObject({ status: 'completed', attempts: 2 });
  });

  test('is safe to run twice, and an already-removed login counts as done', async () => {
    await deleteAccount('u1');
    mockDeleteUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    await expect(deleteAccount('u1')).resolves.toBeDefined();
  });

  test('a missing like index does not block deletion', async () => {
    const orig = mockFake.collectionGroup;
    mockFake.collectionGroup = () => { throw Object.assign(new Error('9 FAILED_PRECONDITION: needs index'), { code: 9 }); };
    const out = await deleteAccount('u1');
    mockFake.collectionGroup = orig;
    expect(out.warnings).toEqual(['likes-index-missing']);
    expect(mockDeleteUser).toHaveBeenCalled();
  });
});

describe('requireRecentLogin', () => {
  const run = (authTime, opts) => {
    const next = jest.fn();
    requireRecentLogin(opts)({ user: { claims: { auth_time: authTime } } }, {}, next);
    return next.mock.calls[0][0];
  };
  const nowS = () => Math.floor(Date.now() / 1000);
  test('accepts a fresh sign-in', () => expect(run(nowS() - 30)).toBeUndefined());
  test('rejects an old sign-in', () => expect(run(nowS() - 3600)).toMatchObject({ statusCode: 401, code: 'REAUTH_REQUIRED' }));
  test('rejects a missing auth_time', () => expect(run(undefined)).toMatchObject({ code: 'REAUTH_REQUIRED' }));
  test('rejects an auth_time in the future', () => expect(run(nowS() + 3600)).toMatchObject({ code: 'REAUTH_REQUIRED' }));
});

describe('DELETE /account route', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/user', require('../src/routes/user'));
  app.use(errorHandler);
  const fresh = () => String(Math.floor(Date.now() / 1000) - 10);

  test('needs the confirmation word', async () => {
    const r = await request(app).delete('/api/user/account').set('x-auth-time', fresh()).send({});
    expect(r.status).toBe(400);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  test('needs a recent sign-in', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 7200);
    const r = await request(app).delete('/api/user/account').set('x-auth-time', old).send({ confirm: 'DELETE' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('REAUTH_REQUIRED');
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  test('deletes and then blocks the old tokens', async () => {
    const r = await request(app).delete('/api/user/account').set('x-auth-time', fresh()).send({ confirm: 'DELETE' });
    expect(r.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith('u1');
    expect(mockMarkDeleted).toHaveBeenCalledWith('u1');
  });

  test('a failed deletion does not block the tokens', async () => {
    mockDeleteUser.mockRejectedValueOnce(new Error('auth down'));
    const r = await request(app).delete('/api/user/account').set('x-auth-time', fresh()).send({ confirm: 'DELETE' });
    expect(r.status).toBe(500);
    expect(mockMarkDeleted).not.toHaveBeenCalled();
  });
});
