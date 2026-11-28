'use strict';

/**
 * Author's choice: a hand-picked list of movies and series, kept in Firestore (`discoverPicks`).
 * One document per title (id "movie-603" / "tv-1399"), so the same title can't be added twice.
 * Only the admin panel writes; the app reads them through the Discover feed "authors-choice".
 */

const { AppError } = require('../utils/errors');

const COLLECTION = 'discoverPicks';
const MAX_PICKS = 100;
const NOTE_MAX = 140;
const IMG = 'https://image.tmdb.org/t/p/w342';

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

function createDiscoverPicks({ getDb, now = () => new Date().toISOString() } = {}) {
  const db = () => (getDb ? getDb() : require('../config/firebase').getFirestore());
  const col = () => db().collection(COLLECTION);

  async function list() {
    const snap = await col().get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    return rows.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function add({ type, tmdbId, title, posterPath, year, note, by }) {
    if (type !== 'movie' && type !== 'tv') throw new AppError('type must be movie or tv', 400, 'VALIDATION_ERROR');
    const id = Number(tmdbId);
    if (!Number.isInteger(id) || id < 1) throw new AppError('Invalid TMDB id', 400, 'VALIDATION_ERROR');
    const name = clean(title, 200);
    if (!name) throw new AppError('A title is required', 400, 'VALIDATION_ERROR');

    const rows = await list();
    const docId = `${type}-${id}`;
    if (rows.some((r) => r.id === docId)) throw new AppError('Already in Author\'s choice', 409, 'CONFLICT');
    if (rows.length >= MAX_PICKS) throw new AppError(`Author's choice is full (${MAX_PICKS})`, 400, 'LIMIT_REACHED');

    const doc = {
      type,
      tmdbId: id,
      title: name,
      posterPath: typeof posterPath === 'string' && /^\/[\w.-]+$/.test(posterPath) ? posterPath : null,
      year: clean(year, 4) || null,
      note: clean(note, NOTE_MAX),
      order: rows.reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1,
      createdAt: now(),
      updatedAt: now(),
      addedBy: by || null,
    };
    await col().doc(docId).set(doc);
    return { id: docId, ...doc };
  }

  async function setNote(id, note) {
    const ref = col().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new AppError('Pick not found', 404, 'NOT_FOUND');
    const text = clean(note, NOTE_MAX);
    await ref.update({ note: text, updatedAt: now() });
    return { id, ...snap.data(), note: text };
  }

  async function remove(id) {
    const ref = col().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new AppError('Pick not found', 404, 'NOT_FOUND');
    await ref.delete();
    return { id, removed: true };
  }

  // ids = the picks in their new order. Picks not mentioned keep their relative order after these.
  async function reorder(ids) {
    const rows = await list();
    const known = new Set(rows.map((r) => r.id));
    const wanted = [...new Set(ids)];
    for (const id of wanted) if (!known.has(id)) throw new AppError(`Pick not found: ${id}`, 404, 'NOT_FOUND');
    const finalIds = [...wanted, ...rows.map((r) => r.id).filter((id) => !wanted.includes(id))];
    const batch = db().batch();
    finalIds.forEach((id, i) => batch.update(col().doc(id), { order: i + 1, updatedAt: now() }));
    await batch.commit();
    return { ids: finalIds };
  }

  // What the app gets: same item shape as every other Discover list.
  async function publicItems(type) {
    const rows = await list();
    return rows
      .filter((r) => r.type === type && r.posterPath)
      .map((r) => ({
        Title: r.title,
        Year: r.year || 'N/A',
        imdbID: `tmdb:${r.type}:${r.tmdbId}`,
        Type: r.type === 'tv' ? 'series' : 'movie',
        Poster: `${IMG}${r.posterPath}`,
        Genre: '',
        imdbRating: 'N/A',
        _tmdbId: r.tmdbId,
        note: r.note || '',
      }));
  }

  return { list, add, setNote, remove, reorder, publicItems };
}

const defaults = createDiscoverPicks();
module.exports = { ...defaults, createDiscoverPicks, MAX_PICKS, NOTE_MAX };
