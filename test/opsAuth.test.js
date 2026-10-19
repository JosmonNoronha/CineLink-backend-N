const request = require('supertest');
const express = require('express');

const SECRET = 'a-long-random-ops-secret-0123456789';

function load(envOverrides = {}) {
  jest.resetModules();
  Object.assign(process.env, { NODE_ENV: 'test', TMDB_API_KEY: 'x'.repeat(32), FIREBASE_SERVICE_ACCOUNT_JSON: '{}' });
  delete process.env.OPS_SECRET;
  delete process.env.METRICS_SECRET;
  Object.assign(process.env, envOverrides);
  return require('../src/middleware/opsAuth');
}

function appWith(chain) {
  const app = express();
  app.get('/ops', ...chain, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('opsAuth', () => {
  afterEach(() => {
    delete process.env.OPS_SECRET;
    delete process.env.METRICS_SECRET;
  });

  test('fails closed (503) when no secret is configured, in every environment', async () => {
    const { requireOpsAuth } = load();
    const res = await request(appWith(requireOpsAuth({ name: 'Metrics' }))).get('/ops');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Metrics endpoint not configured');
  });

  test('accepts Bearer, X-Ops-Token, X-Metrics-Token and Basic password', async () => {
    const { requireOpsAuth } = load({ OPS_SECRET: SECRET });
    const app = appWith(requireOpsAuth());
    const basic = Buffer.from(`ops:${SECRET}`).toString('base64');

    expect((await request(app).get('/ops').set('Authorization', `Bearer ${SECRET}`)).status).toBe(200);
    expect((await request(app).get('/ops').set('X-Ops-Token', SECRET)).status).toBe(200);
    expect((await request(app).get('/ops').set('X-Metrics-Token', SECRET)).status).toBe(200);
    expect((await request(app).get('/ops').set('Authorization', `Basic ${basic}`)).status).toBe(200);
  });

  test('rejects a bare Authorization header, wrong secrets and missing credentials with 403', async () => {
    const { requireOpsAuth } = load({ OPS_SECRET: SECRET });
    const app = appWith(requireOpsAuth());

    expect((await request(app).get('/ops').set('Authorization', SECRET)).status).toBe(403);
    expect((await request(app).get('/ops').set('Authorization', 'Bearer nope')).status).toBe(403);
    expect((await request(app).get('/ops')).status).toBe(403);
  });

  test('browser mode answers 401 with a Basic challenge', async () => {
    const { requireOpsAuth } = load({ OPS_SECRET: SECRET });
    const res = await request(appWith(requireOpsAuth({ challenge: true }))).get('/ops');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Basic/);
  });

  test('falls back to METRICS_SECRET so existing deployments keep working', async () => {
    const { requireOpsAuth } = load({ METRICS_SECRET: SECRET });
    const res = await request(appWith(requireOpsAuth())).get('/ops').set('Authorization', `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
  });

  test('locks out an IP after repeated failures, successes do not count', async () => {
    const { requireOpsAuth } = load({ OPS_SECRET: SECRET });
    const app = appWith(requireOpsAuth());

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).get('/ops').set('Authorization', `Bearer ${SECRET}`)).status).toBe(200);
    }
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).get('/ops').set('Authorization', 'Bearer wrong')).status).toBe(403);
    }
    expect((await request(app).get('/ops').set('Authorization', `Bearer ${SECRET}`)).status).toBe(429);
  });

  test('status monitor gate protects the path and leaves other paths alone', async () => {
    load({ OPS_SECRET: SECRET });
    const { mountStatusMonitorGate } = require('../src/middleware/statusMonitor');
    const app = express();
    mountStatusMonitorGate(app);
    app.get('/status-monitor', (_req, res) => res.send('dashboard'));
    app.get('/status-monitor/anything', (_req, res) => res.send('asset'));
    app.get('/public', (_req, res) => res.send('open'));

    expect((await request(app).get('/status-monitor')).status).toBe(401);
    expect((await request(app).get('/status-monitor/anything')).status).toBe(401);
    expect((await request(app).get('/public')).status).toBe(200);
    expect((await request(app).get('/status-monitor').set('Authorization', `Bearer ${SECRET}`)).text).toBe('dashboard');
  });

  test('status monitor stays off unless explicitly enabled with a secret', () => {
    load({ OPS_SECRET: SECRET });
    const { isStatusMonitorEnabled } = require('../src/middleware/statusMonitor');
    expect(isStatusMonitorEnabled({ NODE_ENV: 'production', STATUS_MONITOR_ENABLED: false })).toBe(false);
    expect(isStatusMonitorEnabled({ NODE_ENV: 'production', STATUS_MONITOR_ENABLED: true })).toBe(true);
    expect(isStatusMonitorEnabled({ NODE_ENV: 'test', STATUS_MONITOR_ENABLED: true })).toBe(false);

    load();
    const fresh = require('../src/middleware/statusMonitor');
    expect(fresh.isStatusMonitorEnabled({ NODE_ENV: 'production', STATUS_MONITOR_ENABLED: true })).toBe(false);
  });

  test('socket authorize helper checks the handshake headers', () => {
    const { hasValidOpsCredential } = load({ OPS_SECRET: SECRET });
    const basic = Buffer.from(`ops:${SECRET}`).toString('base64');
    expect(hasValidOpsCredential({ authorization: `Basic ${basic}` })).toBe(true);
    expect(hasValidOpsCredential({ authorization: 'Basic ' + Buffer.from('ops:bad').toString('base64') })).toBe(false);
    expect(hasValidOpsCredential({})).toBe(false);
  });
});
