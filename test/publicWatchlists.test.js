jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: { serverTimestamp: jest.fn(() => 'TS'), increment: jest.fn((n) => ({ inc: n })) },
    Timestamp: class { constructor(s, n) { this._seconds = s; this._nanoseconds = n; } },
  },
}));
jest.mock('../src/config/firebase', () => ({ getFirestore: () => ({}) }));
jest.mock('../src/services/tmdb/cache', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn() }));
jest.mock('../src/services/tmdb/movies', () => ({}));
jest.mock('../src/services/tmdb/tv', () => ({}));

const { _internal: h } = require('../src/services/publicWatchlists');

describe('publicWatchlists helpers', () => {
  test('sanitizeOwnerName never exposes an email', () => {
    expect(h.sanitizeOwnerName('a@b.com')).toBe('Anonymous');
    expect(h.sanitizeOwnerName('')).toBe('Anonymous');
    expect(h.sanitizeOwnerName(undefined)).toBe('Anonymous');
    expect(h.sanitizeOwnerName('  Josmon ')).toBe('Josmon');
    expect(h.sanitizeOwnerName('x'.repeat(100))).toHaveLength(40);
  });

  test('normalizeTags lowercases, dedupes, drops empties and caps at 10', () => {
    expect(h.normalizeTags(['Horror', 'horror ', '', 'Thriller'])).toEqual(['horror', 'thriller']);
    expect(h.normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10);
    expect(h.normalizeTags(undefined)).toEqual([]);
  });

  test('buildPosterUrl only produces TMDB image URLs', () => {
    expect(h.buildPosterUrl('/a.jpg')).toBe('https://image.tmdb.org/t/p/w500/a.jpg');
    expect(h.buildPosterUrl(null)).toBeNull();
  });

  test('cursor round-trips and rejects garbage', () => {
    const c = h.encodeCursor({ likeCount: 3, createdAt: { _seconds: 1, _nanoseconds: 2 } });
    expect(h.decodeCursor(c).likeCount).toBe(3);
    expect(() => h.decodeCursor('%%%not-json')).toThrow('Invalid cursor');
  });

  test('serializeList clamps negative counters', () => {
    expect(h.serializeList('x', { likeCount: -2, followCount: -1 })).toMatchObject({ likeCount: 0, followCount: 0 });
  });

  test('makeItemKey format matches the delete route pattern', () => {
    expect(h.makeItemKey(694, 'movie')).toMatch(/^(movie|tv):\d+$/);
  });
});