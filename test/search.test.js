const request = require('supertest');

jest.mock('../src/services/search/unified', () => ({
  unifiedSearch: jest.fn().mockResolvedValue({
    Search: [
      {
        Title: 'The Matrix',
        Year: '1999',
        imdbID: 'tt0133093',
        Type: 'movie',
        Poster: 'https://example.com/matrix.jpg',
      },
    ],
    totalResults: '1',
    Response: 'True',
    meta: {
      hasMore: false,
      isTotalExact: true,
      source: 'title',
      totalResultsExact: 1,
      totalResultsEstimated: 1,
      nextCursor: null,
      sources: {
        title: {
          totalResults: 1,
          totalPages: 1,
        },
      },
    },
  }),
}));

jest.setTimeout(45_000);

describe('Unified search endpoint', () => {
  test('POST /api/search returns unified search payload', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app)
      .post('/api/search')
      .send({ query: 'Matrix', type: 'all', page: 1, filters: {} });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data.Search');
    expect(res.body).toHaveProperty('data.totalResults', '1');
    expect(res.body).toHaveProperty('data.meta.hasMore', false);
    expect(res.body).toHaveProperty('data.meta.isTotalExact', true);
    expect(res.body.data.Search[0]).toMatchObject({
      Title: 'The Matrix',
      imdbID: 'tt0133093',
      Type: 'movie',
    });
  });

  test('POST /api/search rejects missing query', async () => {
    const { createApp } = require('../src/app');
    const app = await createApp();

    const res = await request(app).post('/api/search').send({ page: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('success', false);
  });
});