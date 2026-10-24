require('express-async-errors');
const request = require('supertest');
const express = require('express');
const { createFakeFirestore } = require('./helpers/fakeFirestoreFull');

const mockFake = createFakeFirestore();

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: { serverTimestamp: jest.fn(() => 'TS'), increment: jest.fn((n) => ({ inc: n })) },
    Timestamp: class { constructor(s, n) { this._seconds = s; this._nanoseconds = n; } },
  },
}));
jest.mock('../src/config/firebase', () => ({ getFirestore: () => mockFake }));
jest.mock('../src/config/environment', () => ({ env: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/tmdb/cache', () => ({ cacheGet: jest.fn().mockResolvedValue(null), cacheSet: jest.fn() }));
jest.mock('../src/services/tmdb/movies', () => ({}));
jest.mock('../src/services/tmdb/tv', () => ({}));
jest.mock('../src/services/moderation', () => ({ REPORT_REASONS: ['spam', 'other'] }));
jest.mock('../src/middleware/auth', () => {
  const { AppError } = require('../src/utils/errors');
  const read = (req) => {
    const uid = req.headers['x-uid'];
    if (uid) req.user = { uid, permissions: [] };
    return uid;
  };
  return {
    authMiddleware: (req, _res, next) =>
      read(req) ? next() : next(new AppError('Missing Authorization bearer token', 401, 'UNAUTHORIZED')),
    optionalAuth: (req, _res, next) => { read(req); next(); },
  };
});

const blocks = require('../src/services/publicWatchlists/blocks');
const svc = require('../src/services/publicWatchlists');
const { errorHandler } = require('../src/middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/public-watchlists', require('../src/routes/publicWatchlists'));
app.use(errorHandler);

const as = (uid) => ({ 'x-uid': uid });
const list = (owner, extra = {}) => ({
  name: `${owner}'s list`, ownerId: owner, ownerName: owner, isPublic: true,
  itemCount: 0, likeCount: 0, followCount: 0, tags: [], ...extra,
});

beforeEach(() => {
  mockFake._clear();
  blocks._resetCacheForTests();
  mockFake._put('publicWatchlists/L-bad', list('bad'));
  mockFake._put('publicWatchlists/L-good', list('good'));
  mockFake._put('publicWatchlists/L-bad/items/movie:1', { tmdb_id: 1, media_type: 'movie', title: 'X' });
});

describe('blocking', () => {
  test('block, list and unblock', async () => {
    await request(app).post('/api/public-watchlists/blocked-users').set(as('me')).send({ userId: 'bad', name: 'Bad Guy' }).expect(200);
    let r = await request(app).get('/api/public-watchlists/blocked-users').set(as('me')).expect(200);
    expect(r.body.data.users).toEqual([expect.objectContaining({ userId: 'bad', name: 'Bad Guy' })]);

    await request(app).delete('/api/public-watchlists/blocked-users/bad').set(as('me')).expect(200);
    r = await request(app).get('/api/public-watchlists/blocked-users').set(as('me')).expect(200);
    expect(r.body.data.users).toEqual([]);
  });

  test('blocking twice is harmless, and you cannot block yourself', async () => {
    await request(app).post('/api/public-watchlists/blocked-users').set(as('me')).send({ userId: 'bad' }).expect(200);
    await request(app).post('/api/public-watchlists/blocked-users').set(as('me')).send({ userId: 'bad' }).expect(200);
    expect((await blocks.listBlocked('me')).users).toHaveLength(1);
    await request(app).post('/api/public-watchlists/blocked-users').set(as('me')).send({ userId: 'me' }).expect(400);
  });

  test('needs sign-in, and an email-shaped name is not stored', async () => {
    await request(app).get('/api/public-watchlists/blocked-users').expect(401);
    await request(app).post('/api/public-watchlists/blocked-users').set(as('me')).send({ userId: 'bad', name: 'a@b.com' }).expect(200);
    expect((await blocks.listBlocked('me')).users[0].name).toBe('Anonymous');
  });

  test('there is a cap on blocked users', async () => {
    for (let i = 0; i < blocks.MAX_BLOCKED; i += 1) mockFake._put(`users/me/blockedUsers/u${i}`, { name: 'x' });
    await request(app).post('/api/public-watchlists/blocked-users').set(as('me')).send({ userId: 'one-more' }).expect(413);
  });

  test('blocks are private: someone else is not affected', async () => {
    await blocks.blockUser('me', 'bad');
    expect(await blocks.getBlockedIds('other')).toEqual(new Set());
  });
});

describe('what a blocker no longer sees', () => {
  beforeEach(async () => { await blocks.blockUser('me', 'bad'); });

  test('discover hides the blocked user\'s lists but keeps others, for the blocker only', async () => {
    const mine = await request(app).get('/api/public-watchlists').set(as('me')).expect(200);
    expect(mine.body.data.lists.map((l) => l.id)).toEqual(['L-good']);
    const other = await request(app).get('/api/public-watchlists').set(as('someone')).expect(200);
    expect(other.body.data.lists.map((l) => l.id).sort()).toEqual(['L-bad', 'L-good']);
    const anon = await request(app).get('/api/public-watchlists').expect(200);
    expect(anon.body.data.lists).toHaveLength(2);
  });

  test('opening the list or its items directly is a 404', async () => {
    await request(app).get('/api/public-watchlists/L-bad').set(as('me')).expect(404);
    await request(app).get('/api/public-watchlists/L-bad/items').set(as('me')).expect(404);
    await request(app).get('/api/public-watchlists/L-good').set(as('me')).expect(200);
    await request(app).get('/api/public-watchlists/L-bad').set(as('someone')).expect(200);
  });

  test('saved lists from the blocked user are hidden', async () => {
    mockFake._put('users/me/followedLists/L-bad', { watchlistId: 'L-bad', followedAt: 'TS' });
    mockFake._put('users/me/followedLists/L-good', { watchlistId: 'L-good', followedAt: 'TS' });
    const r = await svc.getFollowedWatchlists('me');
    expect(r.lists.map((l) => l.id)).toEqual(['L-good']);
  });

  test('unblocking brings the lists back', async () => {
    await request(app).delete('/api/public-watchlists/blocked-users/bad').set(as('me')).expect(200);
    const r = await request(app).get('/api/public-watchlists').set(as('me')).expect(200);
    expect(r.body.data.lists).toHaveLength(2);
  });

  test('a Firestore read failure does not break the list screen', async () => {
    blocks._resetCacheForTests();
    const orig = mockFake.collection;
    mockFake.collection = (n) => {
      if (n === 'users') throw new Error('boom');
      return orig(n);
    };
    const r = await request(app).get('/api/public-watchlists').set(as('me'));
    mockFake.collection = orig;
    expect(r.status).toBe(200);
  });
});
