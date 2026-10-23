// In-memory Firestore for the account-deletion tests. On top of the basics it supports delete,
// write batches, collectionGroup(), recursiveDelete(), increment values, and ref.parent.
'use strict';

function createFakeFirestore() {
  const store = new Map();
  let auto = 0;
  const apply = (old, data) => {
    const out = { ...(old || {}) };
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && typeof v.inc === 'number') out[k] = (Number(out[k]) || 0) + v.inc;
      else out[k] = v;
    }
    return out;
  };
  const snap = (path, ref) => {
    const data = store.get(path);
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }), ref };
  };

  function docRef(path) {
    const parts = path.split('/');
    const ref = {
      path,
      id: parts.pop(),
      get parent() { return collRef(parts.join('/')); },
      collection: (name) => collRef(`${path}/${name}`),
      get: async () => snap(path, ref),
      set: async (data, opts) => { store.set(path, opts && opts.merge ? apply(store.get(path), data) : apply({}, data)); },
      update: async (data) => {
        if (!store.has(path)) throw new Error(`update on missing doc ${path}`);
        store.set(path, apply(store.get(path), data));
      },
      delete: async () => { store.delete(path); },
    };
    // a doc's parent is a collection whose own parent is a doc: expose that for like -> list
    Object.defineProperty(ref, 'parent', {
      get() {
        const col = parts.join('/');
        const c = collRef(col);
        const cp = col.split('/');
        c.parent = cp.length > 1 ? docRef(cp.slice(0, -1).join('/')) : null;
        return c;
      },
    });
    return ref;
  }

  function query(match, filters = [], max = null) {
    const run = () => {
      let rows = [...store.entries()].filter(([k]) => match(k)).filter(([, v]) => filters.every(([f, val]) => v[f] === val));
      if (max != null) rows = rows.slice(0, max);
      const docs = rows.map(([k]) => snap(k, docRef(k)));
      return { docs, empty: docs.length === 0, size: docs.length };
    };
    return {
      where: (f, op, val) => {
        if (op !== '==') throw new Error('fake supports == only');
        return query(match, [...filters, [f, val]], max);
      },
      orderBy: () => query(match, filters, max),
      limit: (n) => query(match, filters, n),
      get: async () => run(),
      _run: run,
    };
  }

  function collRef(path) {
    const depth = path.split('/').length + 1;
    const q = query((k) => k.startsWith(`${path}/`) && k.split('/').length === depth);
    return { path, doc: (id) => docRef(`${path}/${id ?? `auto${++auto}`}`), ...q };
  }

  const db = {
    collection: (name) => collRef(name),
    collectionGroup: (name) => query((k) => { const p = k.split('/'); return p.length % 2 === 0 && p[p.length - 2] === name; }),
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const o of ops) await o(); },
      };
    },
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (t) => (t._run ? t._run() : t.get()),
        set: (ref, data) => writes.push(() => ref.set(data)),
        update: (ref, data) => writes.push(() => ref.update(data)),
        delete: (ref) => writes.push(() => ref.delete()),
      };
      const result = await fn(tx);
      for (const w of writes) await w();
      return result;
    },
    recursiveDelete: async (ref) => {
      for (const k of [...store.keys()]) if (k === ref.path || k.startsWith(`${ref.path}/`)) store.delete(k);
    },
    _put: (path, data) => store.set(path, { ...data }),
    _get: (path) => store.get(path),
    _clear: () => store.clear(),
    _paths: (prefix = '') => [...store.keys()].filter((k) => k.startsWith(prefix)),
  };
  return db;
}

module.exports = { createFakeFirestore };
