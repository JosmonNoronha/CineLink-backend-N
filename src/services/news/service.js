'use strict';

const { CATEGORIES } = require('./parse');
const { rankOf } = require('./rank');
const { SOURCES } = require('./sources');
const { AppError } = require('../../utils/errors');

const CACHE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_FIELDS = ['id', 'title', 'excerpt', 'url', 'image', 'sourceName', 'source', 'region', 'category', 'publishedAt', 'buzz'];

const HOUR = 3600000;
const SORTS = ['latest', 'trending', 'today', 'week'];
const WINDOW = { trending: 48 * HOUR, today: 24 * HOUR, week: 7 * 24 * HOUR };
const cursorOf = (it) => `${it.publishedAt}.${it.id}`;
function parseCursor(c) {
  const m = /^(\d{10,14})\.([0-9a-f]{16})$/.exec(c || '');
  return m ? { at: Number(m[1]), id: m[2] } : null;
}

function createNewsService({ store, now = () => Date.now() }) {
  let cache = null;

  async function load() {
    if (cache && now() - cache.at < CACHE_TTL_MS) return cache;
    const [feed, meta] = await Promise.all([store.loadFeed(), store.loadMeta()]);
    const hidden = new Set(meta.hidden);
    const disabled = new Set(meta.disabledSources);
    const items = (feed.items || []).filter((i) => !hidden.has(i.id) && !disabled.has(i.source));
    cache = { at: now(), items, updatedAt: feed.updatedAt || 0, meta };
    return cache;
  }
  const invalidate = () => {
    cache = null;
  };

  /**
   * sort: latest (default) | today (last 24h) | trending (last 48h, biggest stories first) |
   *       week (last 7 days, biggest stories first).
   * `before` is the nextCursor of the previous page.
   */
  async function list({ sort = 'latest', category, region, limit = 20, before } = {}) {
    if (!SORTS.includes(sort)) throw new AppError('Unknown sort', 400, 'BAD_SORT');
    if (category && category !== 'all' && !CATEGORIES.includes(category)) throw new AppError('Unknown category', 400, 'BAD_CATEGORY');
    const { items, updatedAt } = await load();
    let rows = items;
    if (category && category !== 'all') rows = rows.filter((i) => i.category === category);
    if (region === 'global' || region === 'in') rows = rows.filter((i) => i.region === region);
    if (WINDOW[sort]) {
      const from = now() - WINDOW[sort];
      rows = rows.filter((i) => i.publishedAt >= from);
    }
    const ranked = sort === 'trending' || sort === 'week';
    let start = 0;
    if (ranked) {
      const t = now();
      const rank = new Map(rows.map((i) => [i.id, rankOf(i, t)]));
      rows = [...rows].sort((a, b) => rank.get(b.id) - rank.get(a.id) || b.publishedAt - a.publishedAt || (a.id < b.id ? -1 : 1));
      if (before) {
        const m = /^o(\d{1,4})$/.exec(before);
        if (!m) throw new AppError('Bad cursor', 400, 'BAD_CURSOR');
        start = Number(m[1]);
      }
      rows = rows.slice(start);
    } else if (before) {
      const c = parseCursor(before);
      if (!c) throw new AppError('Bad cursor', 400, 'BAD_CURSOR');
      rows = rows.filter((i) => i.publishedAt < c.at || (i.publishedAt === c.at && i.id > c.id));
    }
    const page = rows.slice(0, limit);
    const more = rows.length > limit;
    return {
      items: page.map((i) => Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, i[k] ?? (k === 'buzz' ? 0 : null)]))),
      nextCursor: !more ? null : ranked ? `o${start + limit}` : cursorOf(page[page.length - 1]),
      updatedAt,
    };
  }

  async function health() {
    const [state, meta, feed] = await Promise.all([store.loadState(), store.loadMeta(), store.loadFeed()]);
    return {
      updatedAt: feed.updatedAt || 0,
      total: (feed.items || []).length,
      hidden: meta.hidden.length,
      sources: SOURCES.map((s) => ({
        id: s.id,
        name: s.name,
        region: s.region,
        disabled: meta.disabledSources.includes(s.id),
        ...(state[s.id] || { status: 'never-run' }),
        etag: undefined,
        lastModified: undefined,
      })),
    };
  }

  async function setHidden(id, hide) {
    const meta = await store.loadMeta();
    const set = new Set(meta.hidden);
    hide ? set.add(id) : set.delete(id);
    await store.saveMeta({ ...meta, hidden: [...set].slice(-1000) });
    invalidate();
    return { id, hidden: hide };
  }

  async function setSourceDisabled(id, disable) {
    if (!SOURCES.some((s) => s.id === id)) throw new AppError('Unknown source', 404, 'NOT_FOUND');
    const meta = await store.loadMeta();
    const set = new Set(meta.disabledSources);
    disable ? set.add(id) : set.delete(id);
    await store.saveMeta({ ...meta, disabledSources: [...set] });
    invalidate();
    return { id, disabled: disable };
  }

  return { list, health, setHidden, setSourceDisabled, invalidate };
}

module.exports = { createNewsService };
