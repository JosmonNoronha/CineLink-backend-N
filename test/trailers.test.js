require('express-async-errors');
const request = require('supertest');
const express = require('express');

const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockTrending = jest.fn();
const mockUpcoming = jest.fn();
const mockMovieVideos = jest.fn();
const mockTvVideos = jest.fn();

jest.mock('../src/services/tmdb/cache', () => ({
  cacheGet: (...a) => mockCacheGet(...a),
  cacheSet: (...a) => mockCacheSet(...a),
}));
jest.mock('../src/services/tmdb/trending', () => ({ trending: (...a) => mockTrending(...a) }));
jest.mock('../src/services/tmdb/movies', () => ({
  listUpcoming: (...a) => mockUpcoming(...a),
  videos: (...a) => mockMovieVideos(...a),
}));
jest.mock('../src/services/tmdb/tv', () => ({ videos: (...a) => mockTvVideos(...a) }));
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { latestTrailers, pickTrailer } = require('../src/services/tmdb/trailers');
const router = require('../src/routes/trailers');
const { errorHandler } = require('../src/middleware/errorHandler');

const vid = (key, o = {}) => ({ site: 'YouTube', type: 'Trailer', official: true, key, name: key, ...o });

describe('pickTrailer', () => {
  test('only YouTube trailers; official beats unofficial; then newest', () => {
    expect(pickTrailer([{ site: 'Vimeo', type: 'Trailer', key: 'v' }, vid('t', { type: 'Teaser' })])).toBeNull();
    expect(pickTrailer(null)).toBeNull();
    const t = pickTrailer([
      vid('old', { published_at: '2025-01-01T00:00:00Z' }),
      vid('new', { published_at: '2026-10-01T00:00:00Z' }),
      vid('fan', { official: false, published_at: '2026-10-20T00:00:00Z' }),
    ]);
    expect(t.key).toBe('new');
  });
});

describe('latestTrailers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockTrending.mockResolvedValue({
      data: {
        results: [
          { id: 1, media_type: 'movie', title: 'M1', poster_path: '/p1' },
          { id: 2, media_type: 'tv', name: 'T2', first_air_date: '2026-09-01' },
          { id: 3, media_type: 'movie', title: 'No Trailer' },
        ],
      },
    });
    mockUpcoming.mockResolvedValue({
      data: { results: [{ id: 1, title: 'M1 (dup)' }, { id: 4, title: 'Soon', release_date: '2027-01-01' }] },
    });
    mockMovieVideos.mockImplementation(async (id) => ({
      data: {
        results:
          id === 1
            ? [vid('m1', { published_at: '2026-10-10T00:00:00Z' })]
            : id === 4
              ? [vid('soon', { published_at: '2026-10-25T00:00:00Z' })]
              : [],
      },
    }));
    mockTvVideos.mockResolvedValue({ data: { results: [vid('t2', { published_at: '2026-10-20T00:00:00Z' })] } });
  });

  test('newest trailer first, titles without a trailer dropped, duplicates merged, upcoming flagged', async () => {
    const { data } = await latestTrailers({ limit: 12 });
    expect(data.map((d) => d.trailer.key)).toEqual(['soon', 't2', 'm1']);
    expect(data.find((d) => d.id === 4).upcoming).toBe(true);
    expect(data.find((d) => d.id === 1).upcoming).toBe(false); // trending wins over the upcoming duplicate
    expect(data.find((d) => d.id === 2)).toMatchObject({ mediaType: 'tv', title: 'T2' });
    expect(mockCacheSet).toHaveBeenCalledTimes(1);
  });

  test('serves from cache without calling TMDB, and respects limit', async () => {
    mockCacheGet.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const { data, source } = await latestTrailers({ limit: 2 });
    expect(data).toHaveLength(2);
    expect(source).toBe('cache');
    expect(mockTrending).not.toHaveBeenCalled();
  });

  test('one failed video lookup does not break the list; empty answers are not cached', async () => {
    mockTvVideos.mockRejectedValue(new Error('boom'));
    const { data } = await latestTrailers({ limit: 12 });
    expect(data.map((d) => d.trailer.key)).toEqual(['soon', 'm1']);

    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockTrending.mockRejectedValue(new Error('down'));
    mockUpcoming.mockRejectedValue(new Error('down'));
    const empty = await latestTrailers({});
    expect(empty.data).toEqual([]);
    expect(mockCacheSet).not.toHaveBeenCalled();
  });
});

describe('GET /trailers', () => {
  const app = express().use('/trending/trailers', router).use(errorHandler);
  test('returns { trailers } and validates limit', async () => {
    mockCacheGet.mockResolvedValue([{ id: 1, trailer: { key: 'a' } }]);
    const ok = await request(app).get('/trending/trailers?limit=5');
    expect(ok.status).toBe(200);
    expect(ok.body.data.trailers).toHaveLength(1);
    expect((await request(app).get('/trending/trailers?limit=99')).status).toBe(400);
  });
});
