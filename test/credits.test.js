jest.mock('../src/config/environment', () => ({
  env: {
    TMDB_IMAGE_BASE_URL: 'https://image.tmdb.org/t/p',
  },
}));

const { normalizeCredits } = require('../src/services/tmdb/credits');

describe('credits normalization', () => {
  test('returns ordered cast with image metadata and null image fallback', () => {
    const result = normalizeCredits({
      cast: [
        {
          id: 10,
          name: 'Actor One',
          character: 'Hero',
          profile_path: '/actor-one.jpg',
          order: 0,
        },
        {
          id: 11,
          name: 'Actor Two',
          character: '',
          profile_path: null,
        },
        { id: 12, name: '' },
      ],
    });

    expect(result.cast).toEqual([
      {
        id: 10,
        name: 'Actor One',
        character: 'Hero',
        profilePath: '/actor-one.jpg',
        profileUrl: 'https://image.tmdb.org/t/p/w185/actor-one.jpg',
        order: 0,
      },
      {
        id: 11,
        name: 'Actor Two',
        character: null,
        profilePath: null,
        profileUrl: null,
        order: 1,
      },
    ]);
  });

  test('limits cast to the supported response size', () => {
    const result = normalizeCredits({
      cast: Array.from({ length: 20 }, (_, index) => ({
        id: index,
        name: `Actor ${index}`,
      })),
    });

    expect(result.cast).toHaveLength(15);
  });
});
