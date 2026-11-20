jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { uid: 'admin1' };
    next();
  },
}));
jest.mock('../src/middleware/rbac', () => ({ requirePermission: () => (req, res, next) => next() }));

require('express-async-errors');
const express = require('express');
const request = require('supertest');
const { parseFeed, stripHtml, canonicalUrl, categorise, truncate } = require('../src/services/news/parse');
const { syncNews, mergeItems, similar, tokens } = require('../src/services/news/sync');
const { createNewsService } = require('../src/services/news/service');
const { createNewsRouters } = require('../src/routes/news');
const { errorHandler } = require('../src/middleware/errorHandler');
const { SOURCES } = require('../src/services/news/sources');
const { scoreItem, buildTerms, isJunk, rankOf } = require('../src/services/news/rank');
const { createTrendTerms } = require('../src/services/news/trending');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toUTCString();
const src = { id: 'a', name: 'Source A', region: 'global', priority: 1 };
const srcIn = { id: 'b', name: 'Source B', region: 'in', priority: 2 };

const rss = (items) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>x</title>${items.join('')}</channel></rss>`;
const item = (o) => `<item><title>${o.title}</title><link>${o.link}</link>${o.desc ? `<description><![CDATA[${o.desc}]]></description>` : ''}<pubDate>${o.date || hoursAgo(1)}</pubDate>${o.extra || ''}</item>`;

describe('parseFeed', () => {
  test('reads RSS with media thumbnail, strips HTML, canonicalises the link', () => {
    const xml = rss([
      item({
        title: 'Dune &amp; Beyond: &lt;b&gt;New&lt;/b&gt; Trailer Drops',
        link: 'http://Example.com/a/story/?utm_source=x&id=7#top',
        desc: '<p>Hello &amp; welcome <script>alert(1)</script>to the <em>show</em>.</p>',
        extra: '<media:thumbnail url="https://img.example.com/t.jpg" width="1" height="1"/>',
      }),
    ]);
    const [it] = parseFeed(xml, src, { now: NOW });
    expect(it.title).toBe('Dune & Beyond: New Trailer Drops');
    expect(it.url).toBe('https://example.com/a/story?id=7');
    expect(it.excerpt).toBe('Hello & welcome to the show.');
    expect(it.image).toBe('https://img.example.com/t.jpg');
    expect(it.category).toBe('trailers');
    expect(it.source).toBe('a');
    expect(it.id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('falls back to enclosure, then to the first <img> in the content', () => {
    const a = parseFeed(rss([item({ title: 'One', link: 'https://e.com/1', extra: '<enclosure url="https://e.com/i.png" type="image/png"/>' })]), src, { now: NOW });
    expect(a[0].image).toBe('https://e.com/i.png');
    const b = parseFeed(rss([item({ title: 'Two', link: 'https://e.com/2', desc: '<img src="http://e.com/p.jpg"> text' })]), src, { now: NOW });
    expect(b[0].image).toBe('https://e.com/p.jpg');
  });

  test('rejects non-https/unsafe image and link schemes', () => {
    const x = parseFeed(rss([item({ title: 'Bad', link: 'javascript:alert(1)' }), item({ title: 'Img', link: 'https://e.com/3', extra: '<media:thumbnail url="data:image/png;base64,AAA"/>' })]), src, { now: NOW });
    expect(x).toHaveLength(1);
    expect(x[0].image).toBeNull();
  });

  test('reads Atom', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom story</title><link rel="alternate" href="https://e.com/atom"/><updated>${new Date(NOW - 3600000).toISOString()}</updated><summary>Short</summary></entry></feed>`;
    const [it] = parseFeed(xml, src, { now: NOW });
    expect(it.url).toBe('https://e.com/atom');
    expect(it.excerpt).toBe('Short');
  });

  test('drops old and undated items, clamps future dates, caps the count', () => {
    const xml = rss([
      item({ title: 'Old', link: 'https://e.com/old', date: hoursAgo(24 * 40) }),
      item({ title: 'Future', link: 'https://e.com/fut', date: new Date(NOW + 5 * 86400000).toUTCString() }),
      '<item><title>NoDate</title><link>https://e.com/nd</link></item>',
      ...[1, 2, 3].map((n) => item({ title: `N${n}`, link: `https://e.com/n${n}`, date: hoursAgo(n + 1) })),
    ]);
    const all = parseFeed(xml, src, { now: NOW });
    expect(all.map((i) => i.title)).toEqual(['Future', 'N1', 'N2', 'N3']);
    expect(all[0].publishedAt).toBe(NOW);
    expect(parseFeed(xml, src, { now: NOW, limit: 2 })).toHaveLength(2);
  });

  test('throws on documents that are not feeds', () => {
    expect(() => parseFeed('<html><body>Blocked</body></html>', src)).toThrow();
    expect(() => parseFeed('', src)).toThrow();
  });

  test('excerpt is capped at 220 characters on a word boundary', () => {
    const [it] = parseFeed(rss([item({ title: 'Long', link: 'https://e.com/l', desc: 'word '.repeat(200) })]), src, { now: NOW });
    expect(it.excerpt.length).toBeLessThanOrEqual(220);
    expect(it.excerpt.endsWith('…')).toBe(true);
  });
});

describe('helpers', () => {
  test('stripHtml, truncate, canonicalUrl', () => {
    expect(stripHtml('<p>A&nbsp;&#8217;b&#x27;</p>')).toBe('A ’b\'');
    expect(truncate('short', 10)).toBe('short');
    expect(canonicalUrl('ftp://x.com')).toBeNull();
    expect(canonicalUrl('https://user:pw@x.com/a')).toBeNull();
    expect(canonicalUrl('https://X.com/a/?fbclid=1&q=2')).toBe('https://x.com/a?q=2');
  });
  test('categorise', () => {
    expect(categorise('Film X review: great', '')).toBe('reviews');
    expect(categorise('Film X crosses ₹100 crore at box office', '')).toBe('boxoffice');
    expect(categorise('Netflix renews hit show', '')).toBe('streaming');
    expect(categorise('Something happened', 'in season two')).toBe('tv');
    expect(categorise('Something happened', '')).toBe('news');
  });
  test('shipped sources are well formed', () => {
    const ids = new Set();
    for (const s of SOURCES) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(['global', 'in']).toContain(s.region);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
    expect(SOURCES.some((s) => s.region === 'in')).toBe(true);
    expect(SOURCES.some((s) => s.region === 'global')).toBe(true);
  });
});

function memStore(init = {}) {
  const d = { feed: { items: [], updatedAt: 0 }, state: {}, meta: { hidden: [], disabledSources: [] }, ...init };
  return {
    d,
    loadFeed: async () => d.feed,
    saveFeed: async (items, updatedAt) => {
      d.feed = { items, updatedAt };
    },
    loadState: async () => d.state,
    saveState: async (s) => {
      d.state = s;
    },
    loadMeta: async () => d.meta,
    saveMeta: async (m) => {
      d.meta = m;
    },
  };
}

describe('syncNews', () => {
  const feedOf = (map) => async (source, prev) => {
    const v = map[source.id];
    if (v instanceof Error) throw v;
    if (v === 304) return { status: 304 };
    return { status: 200, body: v, etag: `"e-${source.id}"`, lastModified: null };
  };
  const base = (extra = {}) => ({ sources: [src, srcIn], now: () => NOW, ...extra });

  test('merges sources, saves feed and state, dedupes the same headline by priority', async () => {
    const store = memStore();
    const report = await syncNews(
      base({
        store,
        fetchFeed: feedOf({
          a: rss([item({ title: 'Big News', link: 'https://a.com/1', date: hoursAgo(2) }), item({ title: 'Only A', link: 'https://a.com/2', date: hoursAgo(3) })]),
          b: rss([item({ title: 'Big News', link: 'https://b.com/1', date: hoursAgo(1) })]),
        }),
      })
    );
    expect(report).toMatchObject({ fetched: 2, failed: 0, total: 2, saved: true });
    const titles = store.d.feed.items.map((i) => `${i.title}|${i.source}`);
    expect(titles).toEqual(['Only A|a', 'Big News|a'].sort((x, y) => 0) && expect.arrayContaining(['Big News|a', 'Only A|a']));
    expect(store.d.state.a.etag).toBe('"e-a"');
  });

  test('one failing source does not block the rest; 304 keeps stored items', async () => {
    const store = memStore();
    await syncNews(base({ store, fetchFeed: feedOf({ a: rss([item({ title: 'A1', link: 'https://a.com/1' })]), b: rss([item({ title: 'B1', link: 'https://b.com/1' })]) }) }));
    const r = await syncNews(base({ store, fetchFeed: feedOf({ a: 304, b: new Error('HTTP 503') }) }));
    expect(r).toMatchObject({ notModified: 1, failed: 1, saved: true });
    expect(store.d.feed.items).toHaveLength(2);
    expect(store.d.state.b.failures).toBe(1);
    expect(store.d.state.b.error).toBe('HTTP 503');
  });

  test('if every source fails, the stored feed is untouched', async () => {
    const store = memStore({ feed: { items: [{ id: 'x'.repeat(16), source: 'a', title: 'Keep', publishedAt: NOW, region: 'global' }], updatedAt: 5 } });
    const r = await syncNews(base({ store, fetchFeed: feedOf({ a: new Error('ENOTFOUND'), b: '<html/>' }) }));
    expect(r.saved).toBe(false);
    expect(store.d.feed.updatedAt).toBe(5);
    expect(store.d.state.a.status).toBe('failed');
  });

  test('disabled sources are skipped and their stored items removed; dry run writes nothing', async () => {
    const store = memStore();
    await syncNews(base({ store, fetchFeed: feedOf({ a: rss([item({ title: 'A1', link: 'https://a.com/1' })]), b: rss([item({ title: 'B1', link: 'https://b.com/1' })]) }) }));
    store.d.meta.disabledSources = ['b'];
    const called = [];
    const spy = async (s, p) => {
      called.push(s.id);
      return feedOf({ a: 304 })(s, p);
    };
    await syncNews(base({ store, fetchFeed: spy }));
    expect(called).toEqual(['a']);
    const before = JSON.stringify(store.d.feed);
    await syncNews(base({ store, fetchFeed: feedOf({ a: rss([item({ title: 'New', link: 'https://a.com/9' })]) }), dryRun: true }));
    expect(JSON.stringify(store.d.feed)).toBe(before);
  });

  test('buzz counts other sources running a similar headline', () => {
    expect(similar(tokens('Dune Part Three trailer released'), tokens('Dune Part Three: first trailer is here'))).toBe(true);
    expect(similar(tokens('Dune Part Three trailer released'), tokens('Netflix renews Wednesday for season three'))).toBe(false);
    const mk = (id, source, title) => ({ id: id.repeat(16), title, source, publishedAt: NOW - 1000, region: 'global' });
    const out = mergeItems(
      [],
      [mk('a', 'a', 'Zendaya joins Dune Part Three cast'), mk('b', 'b', 'Zendaya joins cast of Dune Part Three'), mk('c', 'c', 'Dune Part Three adds Zendaya to the cast'), mk('d', 'a', 'Netflix cancels Sandman spinoff')],
      [src, srcIn, { id: 'c', name: 'C', region: 'global', priority: 3 }],
      { now: NOW }
    );
    const byTitle = Object.fromEntries(out.map((i) => [i.title, i.buzz]));
    expect(byTitle['Zendaya joins Dune Part Three cast']).toBe(2);
    expect(byTitle['Netflix cancels Sandman spinoff']).toBe(0);
  });

  test('mergeItems caps per source and overall, newest first', () => {
    const mk = (n, s) => ({ id: String(n).padStart(16, '0'), title: `t${n}${s}`, source: s, publishedAt: NOW - n * 1000, region: 'global' });
    const fresh = Array.from({ length: 10 }, (_, i) => mk(i, 'a'));
    const out = mergeItems([], fresh, [src], { now: NOW, limits: { maxAgeDays: 21, maxPerSource: 4, maxStored: 3 } });
    expect(out.map((i) => i.title)).toEqual(['t0a', 't1a', 't2a']);
  });
});

describe('ranking', () => {
  const base = { title: 'Something happened', excerpt: '', buzz: 0 };
  const terms = buildTerms(['Avengers: Doomsday', 'Robert Pattinson']);
  test('big-news signals lift a story; listicles and junk do not', () => {
    const bond = scoreItem({ ...base, title: 'Robert Pattinson cast as James Bond' }, { terms, sourcePriority: 1 });
    const fluff = scoreItem({ ...base, title: '10 best superhero movies ranked' }, { terms, sourcePriority: 3 });
    const plain = scoreItem(base, { terms, sourcePriority: 3 });
    expect(bond).toBeGreaterThan(plain + 8);
    expect(fluff).toBeLessThan(plain);
    expect(scoreItem({ ...base, title: 'Doomsday trailer lands' }, { terms, sourcePriority: 2 })).toBeGreaterThan(plain + 4);
    expect(scoreItem({ ...base, buzz: 3 }, { terms, sourcePriority: 3 })).toBe(plain + 9);
    expect(isJunk('Best Black Friday deals on TVs')).toBe(true);
    expect(isJunk('Oscars race heats up')).toBe(false);
  });
  test('terms match whole words only', () => {
    const t = buildTerms([]);
    expect(scoreItem({ ...base, title: 'A marvelous evening' }, { terms: t })).toBe(0);
    expect(scoreItem({ ...base, title: 'Marvel confirms new team' }, { terms: t })).toBeGreaterThanOrEqual(4);
  });
  test('rankOf adds a bonus that fades over two days', () => {
    expect(rankOf({ score: 5, publishedAt: NOW }, NOW)).toBe(13);
    expect(rankOf({ score: 5, publishedAt: NOW - 48 * 3600000 }, NOW)).toBe(5);
  });
  test('trend terms from TMDB: whole title and each side of the colon, key never leaked', async () => {
    const http = {
      get: jest.fn(async (url) => ({
        data: { results: url.includes('person') ? [{ name: 'Robert Pattinson' }] : [{ title: 'Avengers: Doomsday' }, { title: 'It' }, { name: 'Up' }] },
      })),
    };
    const terms = await createTrendTerms({ apiKey: 'k'.repeat(32), http }).load();
    expect(terms).toEqual(expect.arrayContaining(['Avengers: Doomsday', 'Avengers', 'Doomsday', 'Robert Pattinson']));
    expect(terms).not.toContain('It');
    http.get.mockRejectedValue({ response: { status: 401 }, message: 'secret kkkk' });
    expect(await createTrendTerms({ apiKey: 'k'.repeat(32), http }).load()).toEqual([]);
    expect(await createTrendTerms({}).load()).toEqual([]);
  });
  test('sync stores scores, drops junk, and survives a TMDB failure', async () => {
    const store = memStore();
    const r = await syncNews({
      sources: [src],
      store,
      now: () => NOW,
      fetchFeed: async () => ({
        status: 200,
        body: rss([
          item({ title: 'Robert Pattinson cast as James Bond', link: 'https://a.com/bond' }),
          item({ title: 'Best Black Friday TV deals', link: 'https://a.com/deal' }),
        ]),
      }),
      getTrendTerms: async () => {
        throw new Error('TMDB request failed (401)');
      },
    });
    expect(r.trendError).toBe('TMDB request failed (401)');
    expect(store.d.feed.items.map((i) => i.title)).toEqual(['Robert Pattinson cast as James Bond']);
    expect(store.d.feed.items[0].score).toBeGreaterThan(5);
  });
});

describe('API', () => {
  const mk = (n, o = {}) => ({
    id: n.toString(16).padStart(16, '0'),
    title: `Story ${n}`,
    excerpt: 'x',
    url: `https://e.com/${n}`,
    image: null,
    source: 'a',
    sourceName: 'Source A',
    region: 'global',
    category: 'news',
    publishedAt: NOW - n * 60000,
    ...o,
  });
  let store;
  let app;
  beforeEach(() => {
    store = memStore({
      feed: {
        updatedAt: NOW,
        items: [mk(1), mk(2, { category: 'trailers' }), mk(3, { region: 'in', source: 'toi-ent' }), mk(4), mk(5, { category: 'trailers', region: 'in', source: 'toi-ent' })],
      },
    });
    const { publicRouter, adminRouter } = createNewsRouters({ service: createNewsService({ store, now: () => NOW }) });
    app = express();
    app.use(express.json());
    app.use('/news', publicRouter);
    app.use('/admin/news', adminRouter);
    app.use(errorHandler);
  });

  test('lists newest first with filters and cursor paging', async () => {
    const r1 = await request(app).get('/news?limit=2').expect(200);
    expect(r1.body.data.items.map((i) => i.title)).toEqual(['Story 1', 'Story 2']);
    expect(r1.body.data.nextCursor).toBeTruthy();
    expect(r1.headers['cache-control']).toBe('public, max-age=300');
    const r2 = await request(app).get(`/news?limit=2&before=${r1.body.data.nextCursor}`).expect(200);
    expect(r2.body.data.items.map((i) => i.title)).toEqual(['Story 3', 'Story 4']);
    const r3 = await request(app).get(`/news?limit=2&before=${r2.body.data.nextCursor}`).expect(200);
    expect(r3.body.data.items.map((i) => i.title)).toEqual(['Story 5']);
    expect(r3.body.data.nextCursor).toBeNull();
    const t = await request(app).get('/news?category=trailers&region=in').expect(200);
    expect(t.body.data.items.map((i) => i.title)).toEqual(['Story 5']);
  });

  test('today / trending / week windows and ranking by coverage', async () => {
    const old = mk(6, { publishedAt: NOW - 30 * 3600000, score: 0 }); // 30h old
    const older = mk(7, { publishedAt: NOW - 5 * 86400000, score: 20 }); // 5 days old, very big
    store.d.feed.items = [mk(1, { score: 0 }), mk(2, { score: 9 }), mk(3, { score: 3 }), old, older];
    const get = async (q) => (await request(app).get(`/news?${q}`).expect(200)).body.data;
    expect((await get('sort=today')).items.map((i) => i.title)).toEqual(['Story 1', 'Story 2', 'Story 3']);
    expect((await get('sort=trending')).items.map((i) => i.title)).toEqual(['Story 2', 'Story 3', 'Story 1', 'Story 6']);
    expect((await get('sort=week')).items.map((i) => i.title)).toEqual(['Story 7', 'Story 2', 'Story 3', 'Story 1', 'Story 6']);
    const p1 = await get('sort=week&limit=2');
    expect(p1.nextCursor).toBe('o2');
    const p2 = await get(`sort=week&limit=2&before=${p1.nextCursor}`);
    expect(p2.items.map((i) => i.title)).toEqual(['Story 3', 'Story 1']);
    expect(p2.nextCursor).toBe('o4');
    await request(app).get('/news?sort=bogus').expect(400);
    await request(app).get(`/news?sort=trending&before=${mk(1).publishedAt}.${mk(1).id}`).expect(400);
  });

  test('public items carry no internals and reject bad input', async () => {
    const r = await request(app).get('/news').expect(200);
    expect(Object.keys(r.body.data.items[0]).sort()).toEqual(
      ['buzz', 'category', 'excerpt', 'id', 'image', 'publishedAt', 'region', 'source', 'sourceName', 'title', 'url'].sort()
    );
    await request(app).get('/news?limit=500').expect(400);
    await request(app).get('/news?category=nope').expect(400);
    await request(app).get('/news?before=abc').expect(400);
  });

  test('hide and disable take effect immediately and can be undone', async () => {
    const id = mk(1).id;
    await request(app).post(`/admin/news/articles/${id}/hide`).expect(200);
    let r = await request(app).get('/news').expect(200);
    expect(r.body.data.items.map((i) => i.title)).not.toContain('Story 1');
    await request(app).delete(`/admin/news/articles/${id}/hide`).expect(200);
    r = await request(app).get('/news').expect(200);
    expect(r.body.data.items.map((i) => i.title)).toContain('Story 1');

    await request(app).post('/admin/news/sources/toi-ent/disable').expect(200);
    r = await request(app).get('/news?region=in').expect(200);
    expect(r.body.data.items).toHaveLength(0);
    await request(app).post('/admin/news/sources/nope-source/disable').expect(404);
    await request(app).post('/admin/news/articles/zzz/hide').expect(400);
  });

  test('health lists every configured source', async () => {
    store.d.state.variety = { status: 'failed', error: 'HTTP 403', etag: '"secret"', failures: 3 };
    const r = await request(app).get('/admin/news/health').expect(200);
    expect(r.body.data.sources).toHaveLength(SOURCES.length);
    const v = r.body.data.sources.find((s) => s.id === 'variety');
    expect(v).toMatchObject({ status: 'failed', failures: 3 });
    expect(v.etag).toBeUndefined();
  });
});
