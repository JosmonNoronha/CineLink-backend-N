const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDoc = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
}));
const mockCollection = jest.fn(() => ({
  doc: mockDoc,
}));

jest.mock('../src/config/firebase', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));

const { listFavorites, addFavorite, removeFavorite } = require('../src/services/user/favorites');

describe('favorites service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns normalized favorites list', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        userFavorites: [{ imdbID: 'tt001', Title: 'First Movie', Poster: 'poster.jpg' }],
      }),
    });

    const favorites = await listFavorites('uid-1');

    expect(favorites).toHaveLength(1);
    expect(favorites[0]).toMatchObject({
      imdbID: 'tt001',
      title: 'First Movie',
      poster: 'poster.jpg',
    });
  });

  it('adds a new favorite and persists it', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userFavorites: [] }),
    });
    mockSet.mockResolvedValueOnce(undefined);

    const result = await addFavorite('uid-1', {
      imdbID: 'tt002',
      Title: 'Second Movie',
      Poster: 'poster-2.jpg',
    });

    expect(result).toHaveLength(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userFavorites: expect.arrayContaining([
          expect.objectContaining({ imdbID: 'tt002', title: 'Second Movie' }),
        ]),
      }),
      { merge: true }
    );
  });

  it('does not duplicate existing favorites', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        userFavorites: [{ imdbID: 'tt003', Title: 'Third Movie' }],
      }),
    });

    const result = await addFavorite('uid-1', {
      imdbID: 'tt003',
      Title: 'Third Movie',
    });

    expect(result).toHaveLength(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('removes an existing favorite', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        userFavorites: [
          { imdbID: 'tt004', Title: 'Remove Me' },
          { imdbID: 'tt005', Title: 'Keep Me' },
        ],
      }),
    });
    mockSet.mockResolvedValueOnce(undefined);

    const result = await removeFavorite('uid-1', 'tt004');

    expect(result).toEqual({ removed: true });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userFavorites: expect.arrayContaining([expect.objectContaining({ imdbID: 'tt005' })]),
      }),
      { merge: true }
    );
  });

  it('returns removed false when item is missing', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userFavorites: [{ imdbID: 'tt006', Title: 'Stay' }] }),
    });

    const result = await removeFavorite('uid-1', 'tt999');

    expect(result).toEqual({ removed: false });
    expect(mockSet).not.toHaveBeenCalled();
  });
});
