const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDoc = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
}));
const mockCollection = jest.fn(() => ({
  doc: mockDoc,
}));
const mockFirestore = {
  collection: mockCollection,
};

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    },
  },
}));

jest.mock('../src/config/firebase', () => ({
  getFirestore: () => mockFirestore,
}));

const {
  ensureProfile,
  getProfile,
  upsertProfile,
  getSubscriptions,
  updateSubscriptions,
  getGamification,
  updateGamification,
} = require('../src/services/user/profile');

describe('profile service', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
  });

  it('creates a profile when missing', async () => {
    mockGet
      .mockResolvedValueOnce({ exists: false, data: () => ({}) })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uid: 'uid-1', identity: { email: 'user@example.com' } }),
      });

    const profile = await ensureProfile('uid-1', { email: 'user@example.com' });

    expect(profile).toMatchObject({
      uid: 'uid-1',
      identity: { email: 'user@example.com' },
    });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'uid-1',
        identity: expect.objectContaining({ email: 'user@example.com' }),
        createdAt: 'SERVER_TIMESTAMP',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('returns existing profile without overwriting', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ uid: 'uid-2', identity: { name: 'Existing' } }),
    });

    const profile = await ensureProfile('uid-2');

    expect(profile).toMatchObject({ uid: 'uid-2', identity: { name: 'Existing' } });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('upserts profile patches', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ uid: 'uid-3', displayName: 'New Name' }),
    });

    const profile = await upsertProfile('uid-3', { displayName: 'New Name' });

    expect(profile.displayName).toBe('New Name');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'uid-3',
        displayName: 'New Name',
        createdAt: 'SERVER_TIMESTAMP',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('reads subscriptions and defaults to empty array', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await expect(getSubscriptions('uid-4')).resolves.toEqual([]);

    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ streamingSubscriptions: ['netflix'] }) });
    await expect(getSubscriptions('uid-4')).resolves.toEqual(['netflix']);
  });

  it('updates subscriptions', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ streamingSubscriptions: ['hulu'] }) });

    const updated = await updateSubscriptions('uid-5', ['hulu']);

    expect(updated.streamingSubscriptions).toEqual(['hulu']);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        streamingSubscriptions: ['hulu'],
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('reads gamification state', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ gamification: { xp: 100 } }) });
    await expect(getGamification('uid-6')).resolves.toEqual({ xp: 100 });
  });

  it('returns null gamification when absent', async () => {
    mockGet.mockResolvedValueOnce({ exists: false, data: () => ({}) });
    await expect(getGamification('uid-6')).resolves.toBeNull();
  });

  it('merges gamification data safely', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        gamification: {
          xp: 50,
          totalWatched: 2,
          listsCreated: 1,
          listsCompleted: 1,
          currentStreak: 2,
          bestStreak: 3,
          lastWatchDate: '2026-04-01',
          unlockedAchievements: ['first_watch'],
          watchedMovieIds: ['tt001'],
          completedListNames: ['favorites'],
          dailyWatchCounts: { '2026-04-01': 1 },
          weeklyWatchCounts: { '2026-W14': 2 },
        },
      }),
    });

    await updateGamification('uid-7', {
      xp: 75,
      totalWatched: 4,
      listsCreated: 2,
      listsCompleted: 3,
      currentStreak: 5,
      bestStreak: 8,
      lastWatchDate: '2026-04-02',
      unlockedAchievements: ['five_watched'],
      watchedMovieIds: ['tt002'],
      completedListNames: ['classics'],
      dailyWatchCounts: { '2026-04-02': 2 },
      weeklyWatchCounts: { '2026-W15': 1 },
      syncedAt: 'ignored',
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        gamification: expect.objectContaining({
          xp: 75,
          totalWatched: 4,
          listsCreated: 2,
          listsCompleted: 3,
          currentStreak: 5,
          bestStreak: 8,
          lastWatchDate: '2026-04-02',
          unlockedAchievements: expect.arrayContaining(['first_watch', 'five_watched']),
          watchedMovieIds: expect.arrayContaining(['tt001', 'tt002']),
          completedListNames: expect.arrayContaining(['favorites', 'classics']),
          dailyWatchCounts: expect.objectContaining({
            '2026-04-01': 1,
            '2026-04-02': 2,
          }),
          weeklyWatchCounts: expect.objectContaining({
            '2026-W14': 2,
            '2026-W15': 1,
          }),
        }),
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });
});
