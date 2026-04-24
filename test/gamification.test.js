const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP');

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => mockServerTimestamp(),
    },
  },
}));

const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();
const mockRunTransaction = jest.fn();
const mockCollection = jest.fn();
const mockDoc = jest.fn();
const mockLimit = jest.fn();
const mockGetFirestore = jest.fn(() => ({
  collection: mockCollection,
  runTransaction: mockRunTransaction,
}));

jest.mock('../src/config/firebase', () => ({
  getFirestore: () => mockGetFirestore(),
}));

const { AppError } = require('../src/utils/errors');
const gamification = require('../src/services/user/gamification');

function createDocSnapshot(exists, data = {}) {
  return {
    exists,
    data: () => data,
  };
}

function setupFirestoreChains() {
  mockLimit.mockReturnValue({ get: mockTransactionGet });
  mockDoc.mockReturnValue({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ collection: jest.fn(() => ({ doc: jest.fn() })) })),
    })),
    get: mockTransactionGet,
    set: mockTransactionSet,
  });
  mockCollection.mockReturnValue({
    doc: mockDoc,
    limit: mockLimit,
  });
}

function mockTransactionSequence(...snapshots) {
  mockTransactionGet.mockReset();
  for (const snapshot of snapshots) {
    mockTransactionGet.mockResolvedValueOnce(snapshot);
  }
}

function buildWatchlistDoc(movies, createdAt = { toMillis: () => Date.now() }) {
  return {
    exists: true,
    data: () => ({ movies, createdAt }),
  };
}

describe('gamification service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFirestoreChains();
    mockRunTransaction.mockImplementation(async (handler) => {
      const tx = {
        get: mockTransactionGet,
        set: mockTransactionSet,
      };
      return handler(tx);
    });
    mockTransactionSet.mockReset();
  });

  describe('helpers', () => {
    it('returns default state shape', () => {
      const state = gamification.defaultState();

      expect(state).toMatchObject({
        xp: 0,
        totalWatched: 0,
        listsCreated: 0,
        listsCompleted: 0,
        currentStreak: 0,
        bestStreak: 0,
      });
      expect(state.watchedMovieIds).toEqual([]);
    });

    it('sanitizes idempotency keys', () => {
      expect(gamification.sanitizeIdempotencyKey('  watch:abc-123!! ')).toBe('watch:abc-123');
      expect(gamification.sanitizeIdempotencyKey('')).toBeNull();
      expect(gamification.sanitizeIdempotencyKey(null)).toBeNull();
    });

    it('computes level info for expected tiers', () => {
      const levelInfo = gamification.getLevelInfo(175);

      expect(levelInfo.current).toMatchObject({ level: 3, title: 'Cinephile' });
      expect(levelInfo.next).toMatchObject({ level: 4, title: 'Film Critic' });
      expect(levelInfo.progress).toBeGreaterThan(0);
      expect(levelInfo.progress).toBeLessThan(1);
    });

    it('recomputes gamification state from watchlists', () => {
      const state = gamification.recomputeStateFromWatchlists([
        {
          id: 'Favorites',
          name: 'Favorites',
          createdAt: { toMillis: () => 10 },
          movies: [
            { imdbID: 'tt001', watched: true },
            { imdbID: 'tt002', watched: true },
          ],
        },
        {
          id: 'Completed',
          name: 'Completed',
          createdAt: { toMillis: () => 20 },
          movies: [{ imdbID: 'tt003', watched: true }],
        },
      ]);

      expect(state.totalWatched).toBe(3);
      expect(state.listsCreated).toBe(2);
      expect(state.listsCompleted).toBe(2);
      expect(state.xp).toBe(3 * 25 + 2 * 15 + 2 * 100);
      expect(state.unlockedAchievements).toEqual(
        expect.arrayContaining(['first_watch', 'first_list', 'first_complete'])
      );
    });
  });

  describe('recordWatch', () => {
    it('awards XP when a watched movie is recorded the first time', async () => {
      mockTransactionSequence(
        createDocSnapshot(false, {}),
        createDocSnapshot(false, {}),
        buildWatchlistDoc([{ imdbID: 'tt0133093', watched: true }])
      );

      const result = await gamification.recordWatch('uid-1', 'tt0133093', 'Favorites', {
        idempotencyKey: 'watch-1',
      });

      expect(result).toMatchObject({
        xpGained: 25,
        canEarnXp: true,
        alreadyRewarded: false,
        replayed: false,
      });
      expect(result.state.totalWatched).toBe(1);
      expect(result.state.xp).toBeGreaterThanOrEqual(25);
      expect(result.newAchievements).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'first_watch' })])
      );
      expect(mockTransactionSet).toHaveBeenCalled();
    });

    it('returns alreadyRewarded when the same movie is recorded twice', async () => {
      mockTransactionSequence(
        createDocSnapshot(false, {}),
        createDocSnapshot(false, {}),
        buildWatchlistDoc([{ imdbID: 'tt0133093', watched: true }])
      );

      await gamification.recordWatch('uid-1', 'tt0133093', 'Favorites', {
        idempotencyKey: 'watch-1',
      });

      mockTransactionSequence(
        createDocSnapshot(true, {
          result: {
            xpGained: 25,
            alreadyRewarded: false,
            replayed: false,
          },
        })
      );

      const second = await gamification.recordWatch('uid-1', 'tt0133093', 'Favorites', {
        idempotencyKey: 'watch-2',
      });

      expect(second.replayed).toBe(true);
      expect(second.xpGained).toBe(25);
    });

    it('throws validation error when movieId is missing', async () => {
      await expect(gamification.recordWatch('uid-1', '', 'Favorites')).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('throws not found when the watchlist does not exist', async () => {
      mockTransactionSequence(createDocSnapshot(false, {}), createDocSnapshot(false, {}), {
        exists: false,
        data: () => ({}),
      });

      await expect(gamification.recordWatch('uid-1', 'tt0133093', 'MissingList')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });

    it('throws when the movie is not eligible for XP', async () => {
      mockTransactionSequence(
        createDocSnapshot(false, {}),
        buildWatchlistDoc([{ imdbID: 'tt0133093', watched: false }])
      );

      await expect(gamification.recordWatch('uid-1', 'tt0133093', 'Favorites')).rejects.toMatchObject({
        statusCode: 409,
        code: 'WATCH_NOT_ELIGIBLE',
      });
    });
  });

  describe('recordListCreated and recordListCompleted', () => {
    it('awards XP when a list is created', async () => {
      mockTransactionSequence(
        createDocSnapshot(false, {}),
        createDocSnapshot(false, {}),
        buildWatchlistDoc([])
      );

      const result = await gamification.recordListCreated('uid-1', 'My List', {
        idempotencyKey: 'list-create-1',
      });

      expect(result).toMatchObject({
        xpGained: 15,
        alreadyRewarded: false,
      });
      expect(result.state.listsCreated).toBe(1);
    });

    it('awards XP when a list is completed', async () => {
      mockTransactionSequence(
        createDocSnapshot(false, {}),
        createDocSnapshot(false, {}),
        buildWatchlistDoc([
          { imdbID: 'tt001', watched: true },
          { imdbID: 'tt002', watched: true },
        ])
      );

      const result = await gamification.recordListCompleted('uid-1', 'Complete Me', {
        idempotencyKey: 'complete-1',
      });

      expect(result).toMatchObject({
        xpGained: 100,
        alreadyCompleted: false,
      });
      expect(result.state.listsCompleted).toBe(1);
    });
  });
});
