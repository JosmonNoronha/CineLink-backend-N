'use strict';

/*
  Batches analytics writes so one request does not cost a dozen Redis commands.

  Hosted Redis (Upstash free: 500K commands a month) bills every command. Counting each request
  straight into Redis used about 12 commands per request. Here the increments are added up in
  memory and written together, one pipeline, every FLUSH_MS (5 minutes by default). Reads flush first,
  so the admin Overview is always current.

  If Redis is not ready at flush time, the batch goes to the in-memory fallback instead of being lost.
*/

const mem = require('./memoryStore');
const { logger } = require('../../utils/logger');

const FLUSH_MS = Number(process.env.ANALYTICS_FLUSH_MS || 5 * 60 * 1000);
const MAX_PENDING_ENTRIES = 3000; // flush early rather than grow without bound

let counters = new Map(); // key -> n
let hashes = new Map(); // key -> Map(field -> n)
let zincrs = new Map(); // key -> Map(member -> n)
let sets = new Map(); // key -> { ttl, members: Set }
let trims = new Map(); // key -> keep
let pending = 0;
let timer = null;
let flushing = Promise.resolve();
let source = null; // () => redis client | null

function configure(getClient) {
  source = getClient;
}

const nested = (map, key) => {
  let m = map.get(key);
  if (!m) { m = new Map(); map.set(key, m); }
  return m;
};

function touch() {
  pending += 1;
  if (!timer) {
    timer = setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }
  if (pending >= MAX_PENDING_ENTRIES) flush().catch(() => {});
}

function counter(key, amount = 1) {
  counters.set(key, (counters.get(key) || 0) + amount);
  touch();
}
function hash(key, field, amount = 1) {
  const h = nested(hashes, key);
  h.set(field, (h.get(field) || 0) + amount);
  touch();
}
function zincr(key, member, amount = 1) {
  const z = nested(zincrs, key);
  z.set(member, (z.get(member) || 0) + amount);
  touch();
}
function set(key, member, ttl) {
  let s = sets.get(key);
  if (!s) { s = { ttl, members: new Set() }; sets.set(key, s); }
  s.members.add(member);
  touch();
}
function trim(key, keep) {
  trims.set(key, keep);
  touch();
}

function takeSnapshot() {
  const snap = { counters, hashes, zincrs, sets, trims };
  counters = new Map(); hashes = new Map(); zincrs = new Map(); sets = new Map(); trims = new Map();
  pending = 0;
  return snap;
}

const isEmpty = (s) => !s.counters.size && !s.hashes.size && !s.zincrs.size && !s.sets.size && !s.trims.size;

function applyToMemory(s) {
  s.counters.forEach((n, k) => mem.incrementCounter(k, n));
  s.hashes.forEach((h, k) => h.forEach((n, f) => mem.incrementHashField(k, f, n)));
  s.zincrs.forEach((z, k) => z.forEach((n, m) => mem.zIncr(k, m, n)));
  s.sets.forEach((v, k) => v.members.forEach((m) => mem.sAdd(k, m)));
  s.trims.forEach((keep, k) => mem.zTrim(k, keep));
}

/** Build one pipeline from a snapshot. Returns the number of commands. */
function buildPipeline(client, s) {
  const p = client.multi();
  let n = 0;
  s.counters.forEach((amt, k) => { p.incrBy(k, amt); n += 1; });
  s.hashes.forEach((h, k) => h.forEach((amt, f) => { p.hIncrBy(k, f, amt); n += 1; }));
  s.zincrs.forEach((z, k) => z.forEach((amt, m) => { p.zIncrBy(k, amt, m); n += 1; }));
  s.sets.forEach((v, k) => { p.sAdd(k, [...v.members]); p.expire(k, v.ttl); n += 2; });
  s.trims.forEach((keep, k) => { p.zRemRangeByRank(k, 0, -(keep + 1)); n += 1; });
  return { p, n };
}

async function doFlush() {
  const snap = takeSnapshot();
  if (isEmpty(snap)) return 0;

  const client = source ? source() : null;
  if (!client) {
    applyToMemory(snap);
    return 0;
  }
  try {
    const { p, n } = buildPipeline(client, snap);
    await p.execAsPipeline();
    return n;
  } catch (error) {
    logger.warn('Analytics flush to Redis failed; kept in memory instead', { error: error.message });
    applyToMemory(snap);
    return 0;
  }
}

/** Write everything pending. Safe to call often; flushes run one after another. */
function flush() {
  flushing = flushing.then(doFlush, doFlush);
  return flushing;
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function reset() {
  stop();
  takeSnapshot();
  flushing = Promise.resolve();
}

module.exports = { configure, counter, hash, zincr, set, trim, flush, stop, reset, _pending: () => pending };
