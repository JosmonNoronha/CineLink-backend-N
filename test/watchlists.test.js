const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDelete = jest.fn();
const mockWatchlistDoc = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
  delete: mockDelete,
}));
const mockLimit = jest.fn(() => ({
  get: jest.fn(),
}));
const mockWatchlistsCollection = jest.fn(() => ({
  doc: mockWatchlistDoc,
  limit: mockLimit,
}));
const mockUserDoc = jest.fn(() => ({
  collection: mockWatchlistsCollection,
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
    },
    Timestamp: {
      now: jest.fn(() => 'TIMESTAMP_NOW'),
    },
  },
}));

jest.mock('../src/config/firebase', () => ({
  getFirestore: () => mockFirestore,
}));

const { AppError } = require('../src/utils/errors');
const {
  listWatchlists,
  createWatchlist,
  getWatchlist,
  deleteWatchlist,
  addItem,
  toggleWatched,
} = require('../src/services/user/watchlists');

describe('watchlists service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLimit.mockReturnValue({
      get: jest.fn(),
    });
    mockWatchlistsCollection.mockReturnValue({
      doc: mockWatchlistDoc,
      limit: mockLimit,
    });
    mockUserDoc.mockReturnValue({
      collection: mockWatchlistsCollection,
    });
    mockCollection.mockReturnValue({
      doc: mockUserDoc,
    });
  });

  it('lists and sorts watchlists by createdAt descending', async () => {
    mockLimit.mockReturnValueOnce({
      get: jest.fn().mockResolvedValueOnce({
        docs: [
          {
            id: 'Older',
            data: () => ({ createdAt: { _seconds: 10 }, movies: [] }),
          },
          {
            id: 'Newer',
            data: () => ({ createdAt: { _seconds: 20 }, items: [] }),
          },
        ],
      }),
    });

    const result = await listWatchlists('uid-1');

    expect(result.map((item) => item.id)).toEqual(['Newer', 'Older']);
    expect(result[0].movies).toEqual([]);
  });

  it('creates a new watchlist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false, data: () => ({}) });
    mockGet.mockResolvedValueOnce({
      id: 'Favorites',
      exists: true,
      data: () => ({ movies: [] }),
    });

    const result = await createWatchlist('uid-1', { name: 'Favorites', description: '' });

    expect(result).toMatchObject({ id: 'Favorites', name: 'Favorites' });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ movies: [], createdAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP' })
    );
  });

  it('throws when creating a duplicate watchlist', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });

    await expect(createWatchlist('uid-1', { name: 'Favorites', description: '' })).rejects.toBeInstanceOf(
      AppError
    );
  });

  it('gets an existing watchlist', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, id: 'Favorites', data: () => ({ movies: [] }) });

    const result = await getWatchlist('uid-1', 'Favorites');

    expect(result).toMatchObject({ id: 'Favorites', movies: [] });
  });

  it('throws when the watchlist is missing', async () => {
    mockGet.mockResolvedValueOnce({ exists: false, data: () => ({}) });

    await expect(getWatchlist('uid-1', 'Missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('adds an item to a watchlist', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ movies: [] }),
    });
    mockSet.mockResolvedValueOnce(undefined);

    const result = await addItem('uid-1', 'Favorites', {
      imdbID: 'tt010',
      Title: 'Added Movie',
      Type: 'movie',
    });

    expect(result).toEqual({ added: true });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        movies: expect.arrayContaining([expect.objectContaining({ imdbID: 'tt010', watched: false })]),
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('returns added false for duplicate items', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ movies: [{ imdbID: 'tt010', Title: 'Existing' }] }),
    });

    const result = await addItem('uid-1', 'Favorites', {
      imdbID: 'tt010',
      Title: 'Existing',
      Type: 'movie',
    });

    expect(result).toEqual({ added: false });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('toggles watched status', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        movies: [
          {
            tmdb_id: 42,
            watched: false,
            title: 'Watch Me',
          },
        ],
      }),
    });
    mockSet.mockResolvedValueOnce(undefined);

    const result = await toggleWatched('uid-1', 'Favorites', 42);

    expect(result).toEqual({ watched: true });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        movies: expect.arrayContaining([
          expect.objectContaining({ tmdb_id: 42, watched: true, watchedAt: 'TIMESTAMP_NOW' }),
        ]),
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true }
    );
  });

  it('deletes a watchlist', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const result = await deleteWatchlist('uid-1', 'Favorites');

    expect(result).toEqual({ removed: true });
    expect(mockDelete).toHaveBeenCalled();
  });
});
