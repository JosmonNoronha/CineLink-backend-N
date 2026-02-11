/*
  Smoke-test CineLink backend endpoints.

  Usage:
    node scripts/smoke-api.js
    BASE_URL=http://localhost:5001/api node scripts/smoke-api.js

  Notes:
  - Requires backend server running.
  - For real data, backend must have a valid TMDB_API_KEY.
*/

const axios = require('axios');

const baseUrl = (process.env.BASE_URL || 'http://localhost:5001/api').replace(/\/+$/, '');

async function main() {
  const client = axios.create({
    baseURL: baseUrl,
    timeout: 15_000,
    headers: { Accept: 'application/json' },
    validateStatus: () => true,
  });

  const results = [];

  async function check(name, fn) {
    try {
      const started = Date.now();
      const res = await fn();
      const ms = Date.now() - started;
      results.push({ name, ok: res.ok, status: res.status, ms, note: res.note });
      if (!res.ok) process.exitCode = 1;
    } catch (e) {
      results.push({ name, ok: false, status: 'ERR', ms: 0, note: e.message });
      process.exitCode = 1;
    }
  }

  await check('GET /health', async () => {
    const r = await client.get('/health');
    return {
      ok: r.status === 200 && r.data?.success === true,
      status: r.status,
      note: r.data?.data?.status,
    };
  });

  await check('GET /movies/search?q=batman', async () => {
    const r = await client.get('/movies/search', { params: { q: 'batman' } });
    const payload = r.data?.data ?? r.data;
    const firstTitle = Array.isArray(payload?.Search) ? payload.Search?.[0]?.Title : payload?.[0]?.Title;
    return {
      ok: r.status === 200,
      status: r.status,
      note: firstTitle || (r.data?.error?.message ?? 'ok'),
    };
  });

  // IMDb example that should resolve via TMDB /find
  await check('GET /movies/details/tt0372784', async () => {
    const r = await client.get('/movies/details/tt0372784');
    const payload = r.data?.data ?? r.data;
    return {
      ok: r.status === 200,
      status: r.status,
      note: payload?.Title || (r.data?.error?.message ?? 'ok'),
    };
  });

  // Legacy recommendations mode
  await check('POST /recommendations {title:"Batman"}', async () => {
    const r = await client.post('/recommendations', { title: 'Batman', top_n: 5 });
    const payload = r.data?.data ?? r.data;
    const count = payload?.recommendations?.length ?? payload?.length;
    return {
      ok: r.status === 200,
      status: r.status,
      note: typeof count === 'number' ? `${count} items` : (r.data?.error?.message ?? 'ok'),
    };
  });

  // Pretty print
  // eslint-disable-next-line no-console
  console.table(
    results.map((r) => ({
      check: r.name,
      ok: r.ok,
      status: r.status,
      ms: r.ms,
      note: r.note,
    }))
  );

  // eslint-disable-next-line no-console
  console.log(`\nBase URL: ${baseUrl}`);
  if (process.exitCode) {
    // eslint-disable-next-line no-console
    console.log(
      'One or more checks failed. If you see 401 from TMDB, set a valid TMDB_API_KEY in backend/.env.'
    );
  }
}

main();
