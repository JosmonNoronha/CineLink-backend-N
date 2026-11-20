'use strict';

/**
 * Firestore layout (3 small docs, so a read costs one document):
 *   news/feed   { items: [...], updatedAt }          what the app shows (about 400 items)
 *   news/state  { sources: { id: {etag, lastModified, status, ...} } }   fetch bookkeeping
 *   news/meta   { hidden: [ids], disabledSources: [ids] }                admin controls
 */
function createNewsStore(db) {
  const ref = (name) => db.collection('news').doc(name);
  const read = async (name, fallback) => {
    const snap = await ref(name).get();
    return snap.exists ? { ...fallback, ...snap.data() } : fallback;
  };
  return {
    loadFeed: () => read('feed', { items: [], updatedAt: 0 }),
    saveFeed: (items, updatedAt) => ref('feed').set({ items, updatedAt }),
    loadState: async () => (await read('state', { sources: {} })).sources || {},
    saveState: (sources) => ref('state').set({ sources }),
    loadMeta: async () => {
      const m = await read('meta', { hidden: [], disabledSources: [] });
      return { hidden: m.hidden || [], disabledSources: m.disabledSources || [] };
    },
    saveMeta: (meta) => ref('meta').set({ hidden: meta.hidden, disabledSources: meta.disabledSources }),
  };
}

module.exports = { createNewsStore };
