require('express-async-errors');
const request = require('supertest');
const express = require('express');

const mockEnv = {};
jest.mock('../src/config/environment', () => ({ env: mockEnv }));
jest.mock('../src/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/middleware/auth', () => {
  const { AppError } = require('../src/utils/errors');
  return {
    authMiddleware: (req, _res, next) => {
      const role = req.headers['x-test-role'];
      if (!role) return next(new AppError('Missing Authorization bearer token', 401, 'UNAUTHORIZED'));
      const perms = { user: ['user:read'], moderator: ['user:read', 'content:moderate'], admin: ['content:moderate', 'admin:all'] }[role];
      req.user = { uid: `${role}-1`, permissions: perms };
      return next();
    },
  };
});

const { buildAdminLinks, parseExtraLinks, isSafeUrl } = require('../src/services/adminLinks');
const router = require('../src/routes/adminLinks');
const { errorHandler } = require('../src/middleware/errorHandler');

const all = (r) => r.groups.flatMap((g) => g.links.map((l) => ({ ...l, group: g.title })));
const find = (r, label) => all(r).find((l) => l.label === label);

describe('buildAdminLinks', () => {
  test('derives Firebase, Render and Upstash links from your config', () => {
    const r = buildAdminLinks(
      { FIREBASE_PROJECT_ID: 'my-proj', REDIS_URL: 'rediss://default:pw@big-fox-1.upstash.io:6379', API_PREFIX: '/api' },
      { RENDER_SERVICE_ID: 'srv-abc123' },
    );
    expect(find(r, 'Users (Authentication)').url).toBe('https://console.firebase.google.com/project/my-proj/authentication/users');
    expect(find(r, 'Backend logs').url).toBe('https://dashboard.render.com/web/srv-abc123/logs');
    expect(find(r, 'Upstash console').hint).toContain('big-fox-1.upstash.io');
    expect(JSON.stringify(r)).not.toContain('pw@'); // never leaks the Redis password
  });

  test('finds the Firebase project id inside the service account JSON', () => {
    const json = JSON.stringify({ project_id: 'from-json' });
    expect(find(buildAdminLinks({ FIREBASE_SERVICE_ACCOUNT_JSON: json }, {}), 'Project overview').url).toContain('/project/from-json/');
    const b64 = Buffer.from(json).toString('base64');
    expect(find(buildAdminLinks({ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: b64 }, {}), 'Project overview').url).toContain('/project/from-json/');
  });

  test('tools that are not set up are still listed, with the setting that fixes them', () => {
    const r = buildAdminLinks({}, {});
    const grafana = find(r, 'Grafana dashboards');
    expect(grafana.url).toBeNull();
    expect(grafana.setup).toMatch(/GRAFANA_URL/);
    expect(find(r, 'Sentry errors').setup).toMatch(/SENTRY_DSN/);
    expect(find(r, 'Status monitor').url).toBeNull();
    const upstash = find(r, 'Upstash console');
    expect(upstash.setup).toMatch(/REDIS_URL/);
    expect(upstash.url).toBe('https://console.upstash.com/redis'); // still openable, to create the database
    expect(r.notSetUp).toBe(all(r).filter((l) => l.setup).length);
    expect(r.notSetUp).toBeGreaterThanOrEqual(4);
  });

  test('configured tools get real links and the count drops', () => {
    const none = buildAdminLinks({}, {});
    const some = buildAdminLinks(
      { GRAFANA_URL: 'https://x.grafana.net/d/1', SENTRY_URL: 'https://sentry.io/organizations/o/issues/', STATUS_MONITOR_ENABLED: true, REDIS_URL: 'rediss://h:1' },
      {},
    );
    expect(find(some, 'Grafana dashboards').url).toBe('https://x.grafana.net/d/1');
    expect(find(some, 'Sentry errors').url).toContain('sentry.io');
    expect(find(some, 'Status monitor').url).toBe('/status-monitor');
    expect(some.notSetUp).toBeLessThan(none.notSetUp);
    expect(find(some, 'Upstash console').setup).toBeUndefined();
  });

  test('covers every service the backend uses', () => {
    const labels = all(buildAdminLinks({}, {})).map((l) => l.label).join('|');
    for (const must of ['Backend service', 'Backend logs', 'Recommendations service', 'Users (Authentication)', 'Firestore data', 'Upstash console', 'Grafana dashboards', 'TMDB API settings', 'Backend repository', 'App repository', 'App Store Connect', 'Google Play Console', 'Health check']) {
      expect(labels).toContain(must);
    }
  });

  test('extra links come from ADMIN_EXTRA_LINKS; unsafe or malformed entries are dropped', () => {
    const raw = JSON.stringify([
      { label: 'Uptime', url: 'https://status.example.com', group: 'Monitoring', hint: 'pings' },
      { label: 'Evil', url: 'javascript:alert(1)' },
      { label: 'Plain http', url: 'http://insecure.example.com' },
      { label: 'No label', url: 'https://ok.example.com' , group: 1 },
      { url: 'https://nolabel.example.com' },
    ]);
    const r = buildAdminLinks({}, { ADMIN_EXTRA_LINKS: raw });
    expect(find(r, 'Uptime')).toMatchObject({ url: 'https://status.example.com', group: 'Monitoring' });
    expect(find(r, 'Evil')).toBeUndefined();
    expect(find(r, 'Plain http')).toBeUndefined();
    expect(parseExtraLinks('not json')).toEqual([]);
    expect(parseExtraLinks('{"a":1}')).toEqual([]);
    expect(parseExtraLinks(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ label: `l${i}`, url: 'https://a.example.com' })))).length).toBe(30);
  });

  test('only https links and same-site paths are ever returned', () => {
    expect(isSafeUrl('https://a.com/x')).toBe(true);
    expect(isSafeUrl('/api/health')).toBe(true);
    for (const bad of ['http://a.com', 'javascript:alert(1)', '//evil.com', 'data:text/html,x', '', null, undefined]) expect(isSafeUrl(bad)).toBe(false);
    const r = buildAdminLinks({ GRAFANA_URL: 'http://insecure' }, {});
    expect(find(r, 'Grafana dashboards').url).toBeNull();
    all(r).forEach((l) => expect(l.url === null || isSafeUrl(l.url)).toBe(true));
  });
});

describe('GET /api/admin/links', () => {
  const app = express();
  app.use('/api/admin/links', router);
  app.use(errorHandler);

  test('admins only', async () => {
    await request(app).get('/api/admin/links').expect(401);
    await request(app).get('/api/admin/links').set('x-test-role', 'user').expect(403);
    await request(app).get('/api/admin/links').set('x-test-role', 'moderator').expect(403);
    const res = await request(app).get('/api/admin/links').set('x-test-role', 'admin').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.groups.length).toBeGreaterThan(5);
    expect(typeof res.body.data.notSetUp).toBe('number');
  });
});
