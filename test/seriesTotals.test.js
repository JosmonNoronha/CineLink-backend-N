'use strict';

const { createSeriesTotals, totalsFromTmdb } = require('../src/services/tmdb/seriesTotals');

const show = (extra = {}) => ({
  seasons: [
    { season_number: 0, episode_count: 4 },
    { season_number: 1, episode_count: 10 },
    { season_number: 2, episode_count: 8 },
    { season_number: 3, episode_count: 0 },
  ],
  ...extra,
});

describe('totalsFromTmdb', () => {
  test('ignores specials and empty seasons', () => {
    expect(totalsFromTmdb(show())).toEqual({ totalSeasons: 2, totalEpisodes: 18, seasonCounts: { 1: 10, 2: 8 } });
  });

  test('counts only aired episodes of a running season and drops later seasons', () => {
    const t = totalsFromTmdb(show({ next_episode_to_air: { season_number: 2, episode_number: 5 }, seasons: [
      { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }, { season_number: 3, episode_count: 6 },
    ] }));
    expect(t).toEqual({ totalSeasons: 2, totalEpisodes: 14, seasonCounts: { 1: 10, 2: 4 } });
  });

  test('returns null when there is nothing usable', () => {
    expect(totalsFromTmdb(null)).toBeNull();
    expect(totalsFromTmdb({ seasons: [{ season_number: 0, episode_count: 3 }] })).toBeNull();
  });
});

describe('createSeriesTotals', () => {
  test('caches, and never throws or leaks the key', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: show() }) };
    const t = createSeriesTotals({ apiKey: 'k'.repeat(32), http });
    expect((await t.get('1')).totalEpisodes).toBe(18);
    await t.get('1');
    expect(http.get).toHaveBeenCalledTimes(1);

    const bad = { get: jest.fn().mockRejectedValue(Object.assign(new Error('boom k'), { response: { status: 500 } })) };
    expect(await createSeriesTotals({ apiKey: 'secret', http: bad }).get('2')).toBeNull();
  });

  test('no key or a bad id means unknown, not an error', async () => {
    expect(await createSeriesTotals({ apiKey: '' }).get('1')).toBeNull();
    expect(await createSeriesTotals({ apiKey: 'x', http: { get: jest.fn() } }).get('abc')).toBeNull();
  });
});
