// Minimal in-memory Firestore for the moderation tests.
// Supports: collection/doc/auto-ids, subcollections, get/set/update, where(==), orderBy, limit,
// getAll, and runTransaction (reads see committed state, writes apply on commit).
'use strict';

function createFakeFirestore() {
  const store = new Map(); // "path" -> data
  let auto = 0;

  const snap = (path, ref) => {
    const data = store.get(path);
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }), ref };
  };

  function docRef(path) {
    const ref = {
      path,
      id: path.split('/').pop(),
      collection: (name) => collRef(`${path}/${name}`),
      get: async () => snap(path, ref),
      set: async (data) => { store.set(path, { ...data }); },
      update: async (data) => {
        if (!store.has(path)) throw new Error(`update on missing doc ${path}`);
        store.set(path, { ...store.get(path), ...data });
      },
    };
    return ref;
  }

  function collRef(path, filters = [], order = null, max = null) {
    const run = () => {
      const depth = path.split('/').length + 1;
      let rows = [...store.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && k.split('/').length === depth)
        .filter(([, v]) => filters.every(([f, val]) => v[f] === val));
      if (order) rows.sort(([, a], [, b]) => (a[order.f] > b[order.f] ? 1 : -1) * (order.dir === 'desc' ? -1 : 1));
      if (max != null) rows = rows.slice(0, max);
      const docs = rows.map(([k]) => snap(k, docRef(k)));
      return { docs, empty: docs.length === 0, size: docs.length };
    };
    return {
      path,
      doc: (id) => docRef(`${path}/${id ?? `auto${++auto}`}`),
      where: (f, op, val) => {
        if (op !== '==') throw new Error('fake supports == only');
        return collRef(path, [...filters, [f, val]], order, max);
      },
      orderBy: (f, dir = 'asc') => collRef(path, filters, { f, dir }, max),
      limit: (n) => collRef(path, filters, order, n),
      get: async () => run(),
      _run: run,
    };
  }

  const db = {
    collection: (name) => collRef(name),
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (target) => (target._run ? target._run() : target.get()),
        set: (ref, data) => writes.push(() => ref.set(data)),
        update: (ref, data) => writes.push(() => ref.update(data)),
      };
      const result = await fn(tx);
      for (const w of writes) await w();
      return result;
    },
    // test helpers
    _put: (path, data) => store.set(path, { ...data }),
    _get: (path) => store.get(path),
    _clear: () => store.clear(),
    _all: (prefix) => [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ path: k, ...v })),
  };
  return db;
}

module.exports = { createFakeFirestore };
