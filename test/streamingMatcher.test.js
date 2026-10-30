const m = require('../src/services/streaming/matcher');
const { getShow } = require('../src/services/streaming/shows');

const show = getShow(8630);
const ch = { key: 'official', priority: 1 };
const vid = (title, o = {}) => ({
  videoId: 'abcdefghijk',
  title,
  seconds: 1300,
  embeddable: true,
  privacy: 'public',
  ...o,
});

describe('parseEpisodeNumber', () => {
  test.each([
    ['SE 01 EP 455 -  Jethalal Ne Kyu Bhide Ki तारीफ ! | Taarak Mehta Ka oltah hashmah', 455],
    ['FULL EPISODE 4832 - Gokuldham Walo Ne Kiya बप्पा Ka स्वागत !', 4832],
    ['FULL EPISODE! 4772 -  Bhide Ne Diya', 4772],
    ['NEW FULL 4732 - Bawri Ki Baate', 4732],
    ['Ganeshotsav | Taarak Mehta Ka Ooltah Chashmah | Full Episode 4832 | 3 Oct 2026', 4832],
    ['Tapu Sena | Full Ep 4851 | 26 Oct 2026 |New Episode', 4851],
    [
      'Taarak Mehta Ka Ooltah Chashmah | तारक मेहता का उल्टा चश्मा | Episode 1085 | 23rd December, 2021',
      1085,
    ],
    ['Daya | Taarak Mehta Ka Ooltah Chashmah|Full Episode 2435| 5 July 2023', 2435],
    ['Taarak Mehta Ka Ooltah Chashmah - Episode 1165 - 21st June 2013', 1165],
    ['Taarak Mehta Ka Ooltah Chashmah - Episode 1204 - 14th August 2013', 1204],
  ])('%s -> %s', (title, n) => expect(m.parseEpisodeNumber(title)).toBe(n));

  test.each([
    'Roshan ने Fruit वाले को दिए | Taarak Mehta Ka Ooltah Chashmah | 30 Sep 2026', // "Sep 2026" is not "ep 2026"
    'Show | 3 Sept 2025',
    'Tapu ki Masti I FULL MOVIE | Taarak Mehta Ka Ooltah Chashmah Ep 01 - 05',
    'Weekly Reliv | Taarak Mehta Ka Ooltah Chashmah - 4821 To 4826 | 21 Sep 2026 To 26 Sep 2026',
    'no number here',
  ])('rejects %s', (title) => expect(m.parseEpisodeNumber(title)).toBeNull());
});

describe('toSource', () => {
  test('accepts a normal full episode and keeps a compact record', () => {
    const hit = m.toSource(
      vid('FULL EPISODE 4832 - x | Taarak Mehta ka Ooltah Chasmah', {
        region: { a: ['IN'] },
        publishedAt: '2026-10-26T10:00:00Z',
      }),
      show,
      ch
    );
    expect(hit.n).toBe(4832);
    expect(hit.src).toMatchObject({ v: 'abcdefghijk', c: 'official', p: 1, s: 1300, r: { a: ['IN'] } });
  });

  test.each([
    ['too short', 'FULL EPISODE 4832 | Taarak Mehta Ka Ooltah Chashmah', { seconds: 300 }],
    ['not embeddable', 'FULL EPISODE 4832 | Taarak Mehta Ka Ooltah Chashmah', { embeddable: false }],
    ['private', 'FULL EPISODE 4832 | Taarak Mehta Ka Ooltah Chashmah', { privacy: 'private' }],
    ['age restricted', 'FULL EPISODE 4832 | Taarak Mehta Ka Ooltah Chashmah', { ageRestricted: true }],
    ['compilation', 'FULL MOVIE | Taarak Mehta Ka Ooltah Chashmah Ep 4832', {}],
    ['weekly recap', 'Weekly Reliv | Taarak Mehta Ka Ooltah Chashmah Ep 4832', {}],
    [
      'another show that contains "Taarak"',
      'Taarakasura’s Call To Battle | Ganesh Kartikey | Full Episode 153',
      {},
    ],
    ['other show, same channel', 'Pushpa Impossible | Ep 1371 | Full Episode | 23 Oct 2026', {}],
    ['impossible number', 'Taarak Mehta Ka Ooltah Chashmah | Ep 99999', {}],
    ['no number', 'Taarak Mehta Ka Ooltah Chashmah | 26 Oct 2026', {}],
  ])('rejects %s', (_n, title, o) => expect(m.toSource(vid(title, o), show, ch)).toBeNull());
});

describe('region and choice', () => {
  const src = (c, p, s, r = null, d = 0) => ({ v: `${c}${s}`.padEnd(11, 'x'), c, p, s, r, d });

  test('playableIn handles allowed, blocked and none', () => {
    expect(m.playableIn(null, 'US')).toBe(true);
    expect(m.playableIn({ a: ['IN'] }, 'in')).toBe(true);
    expect(m.playableIn({ a: ['IN'] }, 'US')).toBe(false);
    expect(m.playableIn({ b: ['IN'] }, 'IN')).toBe(false);
    expect(m.playableIn({ b: ['IN'] }, 'US')).toBe(true);
  });

  test('official wins when playable, regional channels fill in where it is not', () => {
    const list = [
      src('pal', 4, 1200, { a: ['IN'] }),
      src('episodes', 2, 1260, { b: ['IN'] }),
      src('official', 1, 1250),
    ];
    expect(m.pickFor(list, 'IN').primary.c).toBe('official');
    expect(m.pickFor(list, 'IN').alt.c).toBe('pal');
    expect(m.pickFor(list, 'US').alt.c).toBe('episodes');
    const noOfficial = list.filter((s) => s.c !== 'official');
    expect(m.pickFor(noOfficial, 'US').primary.c).toBe('episodes');
    expect(m.pickFor(noOfficial, 'IN').primary.c).toBe('pal');
  });

  test('same priority: longer video first; nothing playable gives null; blocked videos are skipped', () => {
    const a = src('sab', 3, 1000);
    const b = src('sab', 3, 1300);
    expect(m.orderSources([a, b])[0]).toBe(b);
    expect(m.pickFor([src('pal', 4, 1200, { a: ['IN'] })], 'US')).toBeNull();
    expect(m.pickFor([b], 'IN', new Set([b.v]))).toBeNull();
    expect(m.pickFor(undefined, 'IN')).toBeNull();
  });

  test('mergeSources keeps one entry per video and lets new data win', () => {
    const old = src('pal', 4, 1200, { a: ['IN'] });
    const merged = m.mergeSources([old], [{ ...old, r: null }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].r).toBeNull();
  });

  test('parseDuration', () => {
    expect(m.parseDuration('PT22M10S')).toBe(1330);
    expect(m.parseDuration('PT1H2M')).toBe(3720);
    expect(m.parseDuration('garbage')).toBe(0);
  });
});
