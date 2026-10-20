const request = require('supertest');
const express = require('express');
const { mountAdminPanel, isAdminPanelEnabled, CSP } = require('../src/routes/adminPanel');

const appWith = (env) => {
  const app = express();
  const mounted = mountAdminPanel(app, env);
  return { app, mounted };
};

describe('admin panel', () => {
  test('is off (404) unless FIREBASE_WEB_API_KEY is set', async () => {
    expect(isAdminPanelEnabled({})).toBe(false);
    const { app, mounted } = appWith({ API_PREFIX: '/api' });
    expect(mounted).toBe(false);
    await request(app).get('/admin/').expect(404);
    await request(app).get('/admin/config.json').expect(404);
  });

  test('serves the page with its own strict CSP and no-store', async () => {
    const { app } = appWith({ FIREBASE_WEB_API_KEY: 'key', API_PREFIX: '/api' });
    const res = await request(app).get('/admin/').expect(200);
    expect(res.text).toContain('CineLink Moderation');
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(CSP).toMatch(/script-src 'self'(;|$)/);
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  test('config.json exposes only the public web key and API prefix', async () => {
    const { app } = appWith({ FIREBASE_WEB_API_KEY: 'abc', API_PREFIX: '/api', OPS_SECRET: 'never-leak' });
    const res = await request(app).get('/admin/config.json').expect(200);
    expect(res.body).toEqual({ apiKey: 'abc', apiBase: '/api', grafanaUrl: null });
    expect(JSON.stringify(res.body)).not.toMatch(/never-leak/);
  });

  test('serves the script and stylesheet', async () => {
    const { app } = appWith({ FIREBASE_WEB_API_KEY: 'k', API_PREFIX: '/api' });
    await request(app).get('/admin/admin.js').expect(200).expect('Content-Type', /javascript/);
    await request(app).get('/admin/admin.css').expect(200).expect('Content-Type', /css/);
  });
});
