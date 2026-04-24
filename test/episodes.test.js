const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDoc = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
}));
const mockWatchedCollection = jest.fn(() => ({
  doc: mockDoc,
}));
const mockUserDoc = jest.fn(() => ({
  collection: mockWatchedCollection,
}));
const mockCollection = jest.fn(() => ({
  doc: mockUserDoc,
}));
const mockFirestore = {
  collection: mockCollection,
};

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      delete: jest.fn(() => 'FIELD_DELETE'),
    },
  },
}));

jest.mock('../src/config/firebase', () => ({
  getFirestore: () => mockFirestore,
}));

const { setEpisodeWatched, getWatchedEpisodes } = require('../src/services/user/episodes');

describe('episodes service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserDoc.mockReturnValue({
      collection: mockWatchedCollection,
    });
    mockWatchedCollection.mockReturnValue({
      doc: mockDoc,
    });
    mockCollection.mockReturnValue({
      doc: mockUserDoc,
    });
  });

  it('stores a watched episode entry', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        s1e1: { watchedAt: '2026-04-01T00:00:00.000Z', season: 1, episode: 1 },
      }),
    });

    const result = await setEpisodeWatched('uid-1', 'content-1', 1, 1, true);

    expect(result).toHaveProperty('s1e1');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        s1e1: expect.objectContaining({
          watchedAt: expect.any(String),
          season: 1,
          episode: 1,
        }),
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('clears a watched episode entry', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ s1e1: { watchedAt: '2026-04-01T00:00:00.000Z', season: 1, episode: 1 } }),
    });

    await setEpisodeWatched('uid-1', 'content-1', 1, 1, false);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        s1e1: 'FIELD_DELETE',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('returns only watched episode keys', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        s1e1: { watchedAt: '2026-04-01T00:00:00.000Z' },
        s1e2: { watchedAt: '2026-04-02T00:00:00.000Z' },
        ignored: 'value',
      }),
    });

    await expect(getWatchedEpisodes('uid-1', 'content-1')).resolves.toEqual({
      s1e1: { watchedAt: '2026-04-01T00:00:00.000Z' },
      s1e2: { watchedAt: '2026-04-02T00:00:00.000Z' },
    });
  });

  it('returns empty object when no episode document exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: false, data: () => ({}) });

    await expect(getWatchedEpisodes('uid-1', 'content-1')).resolves.toEqual({});
  });
});
