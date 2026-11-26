'use strict';
// Tiny in-memory Firestore: just enough for the watched-title tests.
const DEL = { __delete: true };
const TS = { __serverTimestamp: true };

function createFakeFirestore() {
  const store = new Map(); // "users/u1/watched/x" -> data

  const clone = (v) => JSON.parse(JSON.stringify(v));
  function applyWrite(path, data, merge) {
    const cur = merge && store.has(path) ? store.get(path) : {};
    const next = { ...cur };
    for (const [k, v] of Object.entries(data)) {
      if (v === DEL) delete next[k];
      else if (v === TS) next[k] = '2026-01-01T00:00:00.000Z';
      else next[k] = clone(v);
    }
    store.set(path, next);
  }

  function docRef(path) {
    const parts = path.split('/');
    return {
      id: parts[parts.length - 1],
      path,
      collection: (name) => collectionRef(`${path}/${name}`),
      async get() {
        const exists = store.has(path);
        return { exists, id: parts[parts.length - 1], ref: docRef(path), data: () => (exists ? clone(store.get(path)) : undefined) };
      },
      async set(data, opts) {
        applyWrite(path, data, !!(opts && opts.merge));
      },
      async delete() {
        store.delete(path);
      },
    };
  }

  function collectionRef(path) {
    return {
      doc: (id) => docRef(`${path}/${id}`),
      limit() {
        return this;
      },
      async get() {
        const depth = path.split('/').length + 1;
        const docs = [];
        for (const key of store.keys()) {
          if (key.startsWith(`${path}/`) && key.split('/').length === depth) {
            const ref = docRef(key);
            docs.push({ id: ref.id, ref, exists: true, data: () => clone(store.get(key)) });
          }
        }
        return { docs };
      },
    };
  }

  return {
    store,
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
}

module.exports = { createFakeFirestore, DEL, TS };
