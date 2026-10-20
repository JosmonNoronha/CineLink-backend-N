'use strict';

/*
  Static moderation panel served at /admin (same origin as the API, so no CORS).

  It is only mounted when FIREBASE_WEB_API_KEY is set. The page itself holds no secrets
  and no data: every action calls /api/admin/moderation/*, which requires a signed-in
  moderator or admin. The panel signs in with Firebase email + password over HTTPS.

  It gets its own Content-Security-Policy (the global one blocks the two Google sign-in hosts).
*/

const path = require('path');
const express = require('express');

const ADMIN_PATH = '/admin';
const UI_DIR = path.join(__dirname, '..', 'admin-ui');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function isAdminPanelEnabled(env) {
  return Boolean(env.FIREBASE_WEB_API_KEY);
}

function createAdminPanelRouter(env) {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  router.get('/config.json', (_req, res) =>
    res.json({ apiKey: env.FIREBASE_WEB_API_KEY, apiBase: env.API_PREFIX }),
  );

  router.use(express.static(UI_DIR, { index: 'index.html', maxAge: 0, fallthrough: true }));
  return router;
}

function mountAdminPanel(app, env) {
  if (!isAdminPanelEnabled(env)) return false;
  app.use(ADMIN_PATH, createAdminPanelRouter(env));
  return true;
}

module.exports = { ADMIN_PATH, CSP, isAdminPanelEnabled, createAdminPanelRouter, mountAdminPanel };
