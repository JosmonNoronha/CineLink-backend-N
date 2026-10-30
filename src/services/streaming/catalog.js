'use strict';

/*
  Firestore layout (all written by the server, read through the API; your rules stay deny-all):
    streamShows/{tmdbId}                 -> { title, updatedAt, blockedVideos: [videoId], lastSync: {...} }
    streamShows/{tmdbId}/chunks/{k}      -> { episodes: { "<n>": [source, ...] }, updatedAt }   (250 episodes per chunk)
*/

const CHUNK = 250;
const chunkOf = (n) => Math.floor((n - 1) / CHUNK);

function createCatalog(db) {
  const show = (id) => db.collection('streamShows').doc(String(id));

  async function loadMeta(id) {
    const snap = await show(id).get();
    return snap.exists ? snap.data() : { blockedVideos: [] };
  }

  /**
   * Replaces the given top-level fields. Firestore's merge would also merge nested maps, which
   * left old "error" and "stoppedEarly" values from a failed run inside a later, healthy report.
   */
  async function saveMeta(id, patch) {
    const current = await loadMeta(id);
    await show(id).set({ ...current, ...patch, updatedAt: Date.now() });
  }

  /** Whole catalog: Map<number, source[]> */
  async function loadEpisodes(id) {
    const snap = await show(id).collection('chunks').get();
    const out = new Map();
    for (const doc of snap.docs) {
      const eps = doc.data().episodes || {};
      Object.entries(eps).forEach(([n, list]) => out.set(Number(n), list));
    }
    return out;
  }

  /** Writes only the chunks that differ from `before`. Returns how many chunks were written. */
  async function saveEpisodes(id, after, before = new Map()) {
    const touched = new Set();
    for (const n of new Set([...after.keys(), ...before.keys()])) {
      if (JSON.stringify(after.get(n) || null) !== JSON.stringify(before.get(n) || null))
        touched.add(chunkOf(n));
    }
    for (const k of touched) {
      const episodes = {};
      for (const [n, list] of after) if (chunkOf(n) === k && list.length) episodes[String(n)] = list;
      await show(id).collection('chunks').doc(String(k)).set({ episodes, updatedAt: Date.now() });
    }
    return touched.size;
  }

  return { loadMeta, saveMeta, loadEpisodes, saveEpisodes, CHUNK };
}

module.exports = { createCatalog, chunkOf, CHUNK };