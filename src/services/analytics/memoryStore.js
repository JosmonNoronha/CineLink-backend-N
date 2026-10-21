'use strict';

/*
  In-process fallback for the analytics counters.

  The analytics code used to do nothing at all when Redis was missing or down, so the admin
  Overview was always empty. This keeps the same numbers in memory instead. They are lost on a
  restart and are per server instance; set REDIS_URL to keep them.

  Everything is bounded so bots hitting random URLs cannot grow memory without limit.
*/

const MAX_COUNTER_KEYS = 500;
const MAX_HASH_KEYS = 50;
const MAX_HASH_FIELDS = 500;
const MAX_ZSET_KEYS = 20;
const MAX_ZSET_MEMBERS = 5000;
const MAX_SET_KEYS = 8; // one per day, so about a week
const MAX_SET_MEMBERS = 100000;
const OTHER = '__other__';

const counters = new Map();
const hashes = new Map();
const zsets = new Map();
const sets = new Map();

function mapOf(store, key, maxKeys) {
  let m = store.get(key);
  if (!m) {
    if (store.size >= maxKeys) store.delete(store.keys().next().value);
    m = new Map();
    store.set(key, m);
  }
  return m;
}

function incrementCounter(key, amount = 1) {
  if (!counters.has(key) && counters.size >= MAX_COUNTER_KEYS) {
    // Drop an old hour/day bucket first; never the totals.
    const old = [...counters.keys()].find((k) => /:(hour|day):/.test(k));
    if (old) counters.delete(old);
    else return false;
  }
  counters.set(key, (counters.get(key) || 0) + amount);
  return true;
}
const getCounter = (key) => (counters.has(key) ? counters.get(key) : null);

function incrementHashField(key, field, amount = 1) {
  const h = mapOf(hashes, key, MAX_HASH_KEYS);
  const f = h.has(field) || h.size < MAX_HASH_FIELDS ? field : OTHER;
  h.set(f, (h.get(f) || 0) + amount);
  return true;
}
function getHash(key) {
  const out = {};
  for (const [f, v] of hashes.get(key) || []) out[f] = String(v);
  return out;
}

function zAdd(key, score, member) {
  const z = mapOf(zsets, key, MAX_ZSET_KEYS);
  z.set(member, score);
  return trim(z);
}
function zIncr(key, member, amount = 1) {
  const z = mapOf(zsets, key, MAX_ZSET_KEYS);
  z.set(member, (z.get(member) || 0) + amount);
  return trim(z);
}
function trim(z, keep = MAX_ZSET_MEMBERS) {
  if (z.size > keep) {
    const lowest = [...z.entries()].sort((a, b) => a[1] - b[1]).slice(0, z.size - keep);
    lowest.forEach(([m]) => z.delete(m));
  }
  return true;
}
function zTrim(key, keep) {
  const z = zsets.get(key);
  if (z) trim(z, keep);
  return true;
}
function zTop(key, limit) {
  return [...(zsets.get(key) || [])]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, score]) => ({ value, score }));
}

function sAdd(key, member) {
  const s = mapOf(sets, key, MAX_SET_KEYS);
  if (s.size < MAX_SET_MEMBERS) s.set(member, true);
  return true;
}
const sCard = (key) => (sets.get(key) ? sets.get(key).size : 0);

function reset() {
  [counters, hashes, zsets, sets].forEach((m) => m.clear());
}

module.exports = {
  incrementCounter, getCounter, incrementHashField, getHash,
  zAdd, zIncr, zTrim, zTop, sAdd, sCard, reset,
};
