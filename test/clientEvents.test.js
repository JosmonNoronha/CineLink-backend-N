require('express-async-errors');
const request = require('supertest');
const express = require('express');

jest.mock('../src/services/analytics', () => ({ analyticsService: {} }));
jest.mock('../src/middleware/auth', () => ({
  optionalAuth: (req, _res, next) => {
    if (req.headers['x-uid']) req.user = { uid: req.headers['x-uid'] };
    next();
  },
  authMiddleware: (_q, _s, n) => n(),
}));
jest.mock('../src/middleware/rbac', () => ({ requirePermission: () => (_q, _s, n) => n() }));
jest.mock('../src/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const { register } = require('../src/routes/metrics');
const { MAX_EVENTS_PER_REQUEST, MAX_DISTINCT_NAMES } = require('../src/services/analytics/clientEvents');
const { errorHandler } = require('../src/middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/analytics', require('../src/routes/analytics'));
app.use(errorHandler);

const counts = async () => {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === 'app_client_events_total');
  return Object.fromEntries(metric.values.map((v) => [v.labels.name, v.value]));
};
const post = (body, uid = 'u-events') => request(app).post('/api/analytics/events').set('x-uid', uid).send(body);

test('counts a single event and a batch, whatever the field is called', async () => {
  const r1 = await post({ name: 'user_login', data: { email: 'secret@x.com' } });
  expect(r1.status).toBe(202);
  expect(r1.body.data.accepted).toBe(1);

  const r2 = await post({ events: [{ type: 'screen_view' }, { event: 'screen_view' }, { action: 'search' }, 'plain_string'] });
  expect(r2.body.data.accepted).toBe(4);

  const c = await counts();
  expect(c.user_login).toBe(1);
  expect(c.screen_view).toBe(2);
  expect(c.search).toBe(1);
  expect(c.plain_string).toBe(1);
});

test('nothing from the event body ends up in the metrics', async () => {
  await post({ name: 'checked', data: { email: 'secret@x.com' } });
  const text = await register.metrics();
  expect(text).not.toContain('secret@x.com');
});

test('works signed out, and bad input is skipped quietly', async () => {
  const res = await request(app).post('/api/analytics/events').send({ events: [{ name: 'ok_event' }, { name: 'bad name!' }, { name: 5 }, null, {}] });
  expect(res.status).toBe(202);
  expect(res.body.data.accepted).toBe(1);
  expect((await request(app).post('/api/analytics/events').send({})).status).toBe(202);
});

test('at most 50 events per request', async () => {
  const events = Array.from({ length: 80 }, () => ({ name: 'bulk_event' }));
  const res = await post({ events });
  expect(res.body.data.accepted).toBe(MAX_EVENTS_PER_REQUEST);
});

test('a flood of different names cannot create endless metric labels', async () => {
  for (let i = 0; i < MAX_DISTINCT_NAMES + 20; i += 1) await post({ name: `flood_${i}` }, `flooder-${i}`);
  const names = Object.keys(await counts());
  expect(names.length).toBeLessThanOrEqual(MAX_DISTINCT_NAMES + 1); // + "other"
  expect((await counts()).other).toBeGreaterThan(0);
});

test('is rate limited per user', async () => {
  let last;
  for (let i = 0; i < 61; i += 1) last = await post({ name: 'spam' }, 'spammer');
  expect(last.status).toBe(429);
  expect((await post({ name: 'fine' }, 'someone-else')).status).toBe(202);
});
