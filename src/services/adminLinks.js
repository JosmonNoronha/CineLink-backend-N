'use strict';

/*
  The list of places an admin needs: hosting, database, cache, monitoring, code, app stores.

  Built from your own configuration so nothing has to be remembered. Anything that is not set up
  yet is still listed, marked "Not set up" with the setting that fixes it, so a missing tool is
  visible instead of silently absent.

  Only https links and same-site paths are ever returned.
*/

const FALLBACK_FIREBASE_PROJECT = 'cinelink-7343e'; // same fallback src/config/firebase.js uses
const MAX_EXTRA_LINKS = 30;

const isSafeUrl = (u) => typeof u === 'string' && (/^https:\/\/[^\s]+$/i.test(u) || /^\/[^\s/][^\s]*$/.test(u));

function firebaseProjectId(env, procEnv) {
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID;
  const readJson = (raw, base64) => {
    try {
      const text = base64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;
      return JSON.parse(text).project_id || null;
    } catch {
      return null;
    }
  };
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const id = readJson(env.FIREBASE_SERVICE_ACCOUNT_JSON, false);
    if (id) return id;
  }
  const b64 = env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || procEnv.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const id = readJson(b64, true);
    if (id) return id;
  }
  return FALLBACK_FIREBASE_PROJECT;
}

function redisHost(redisUrl) {
  try {
    return new URL(redisUrl).hostname || null;
  } catch {
    return null;
  }
}

/** Parse ADMIN_EXTRA_LINKS: a JSON array of {label, url, group?, hint?}. Bad entries are dropped. */
function parseExtraLinks(raw) {
  if (!raw) return [];
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((l) => l && typeof l.label === 'string' && l.label.trim() && isSafeUrl(l.url))
    .slice(0, MAX_EXTRA_LINKS)
    .map((l) => ({
      group: typeof l.group === 'string' && l.group.trim() ? l.group.trim().slice(0, 40) : 'Your own links',
      label: l.label.trim().slice(0, 60),
      url: l.url,
      hint: typeof l.hint === 'string' ? l.hint.trim().slice(0, 120) : '',
    }));
}

/**
 * A link with `setup` is not configured yet: `setup` says which setting fixes it. It may still have a url (e.g. the Upstash console).
 * @returns {{groups: Array<{title: string, links: Array<{label: string, url: string|null, hint: string, setup?: string}>}>, notSetUp: number}}
 */
function buildAdminLinks(env = {}, procEnv = process.env) {
  const prefix = env.API_PREFIX || '/api';
  const projectId = firebaseProjectId(env, procEnv);
  const fb = (path) => `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/${path}`;
  const renderId = procEnv.RENDER_SERVICE_ID;
  const render = (path = '') => (renderId ? `https://dashboard.render.com/web/${encodeURIComponent(renderId)}${path}` : 'https://dashboard.render.com/');
  const host = redisHost(env.REDIS_URL);

  const L = (label, url, hint = '', setup) => ({ label, url: url && isSafeUrl(url) ? url : null, hint, ...(setup ? { setup } : {}) });

  const groups = [
    {
      title: 'This backend',
      links: [
        L('Health check', `${prefix}/health`, 'Quick "is it up"'),
        L('Deep health check', `${prefix}/health/deep`, 'Also tests Firestore and TMDB'),
        env.STATUS_MONITOR_ENABLED
          ? L('Status monitor', '/status-monitor', 'Live CPU, memory and requests. Asks for the ops secret as the password')
          : L('Status monitor', null, 'Live CPU, memory and requests (off by default)', 'Set STATUS_MONITOR_ENABLED=true on Render, only while debugging'),
      ],
    },
    {
      title: 'Hosting (Render)',
      links: [
        L('Backend service', render(), renderId ? 'Deploys, settings' : 'Opens your Render dashboard'),
        L('Backend logs', render('/logs'), 'Live server logs'),
        L('Backend environment variables', render('/env'), 'Where secrets and settings live'),
        L('Recommendations service', 'https://movie-reco-api.onrender.com', 'Separate Render service used by /recommend (can sleep on the free plan)'),
      ],
    },
    {
      title: 'Database and accounts (Firebase)',
      links: [
        L('Project overview', fb('overview'), projectId),
        L('Users (Authentication)', fb('authentication/users'), 'Find, disable or delete an account'),
        L('Firestore data', fb('firestore'), 'Lists, reports, audit log, user data'),
        L('Project settings', fb('settings/general'), 'Web API key, service accounts'),
        L('Google Cloud console', `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projectId)}`, 'Billing and quotas'),
      ],
    },
    {
      title: 'Cache (Upstash Redis)',
      links: [
        env.REDIS_URL
          ? L('Upstash console', 'https://console.upstash.com/redis', host ? `Your database: ${host}` : 'Usage and command count')
          : L('Upstash console', 'https://console.upstash.com/redis', 'Open it to create or check your database', 'Redis is not connected: set REDIS_URL (rediss://...) on Render'),
      ],
    },
    {
      title: 'Monitoring',
      links: [
        env.GRAFANA_URL
          ? L('Grafana dashboards', env.GRAFANA_URL, 'Request rates, errors, cache')
          : L('Grafana dashboards', null, 'Request rates, errors, cache', 'Set GRAFANA_URL (an https link) on Render'),
        env.SENTRY_URL
          ? L('Sentry errors', env.SENTRY_URL, 'Crashes and exceptions')
          : env.SENTRY_DSN
            ? L('Sentry', 'https://sentry.io/', 'Crashes and exceptions', undefined)
            : L('Sentry errors', null, 'Crashes and exceptions', 'Set SENTRY_DSN (and SENTRY_URL for a direct link) on Render'),
      ],
    },
    {
      title: 'Movie data (TMDB)',
      links: [L('TMDB API settings', 'https://www.themoviedb.org/settings/api', 'Your API key and usage terms')],
    },
    {
      title: 'Code',
      links: [
        L('Backend repository', 'https://github.com/JosmonNoronha/CineLink-backend-N', 'Pushing here auto-deploys to Render'),
        L('App repository', 'https://github.com/JosmonNoronha/Cine-link', 'The React Native app'),
      ],
    },
    {
      title: 'App releases',
      links: [
        L('Expo (EAS builds)', 'https://expo.dev/', 'App builds and updates'),
        L('App Store Connect', 'https://appstoreconnect.apple.com/', 'iOS releases and review'),
        L('Google Play Console', 'https://play.google.com/console/', 'Android releases'),
      ],
    },
  ];

  const extra = parseExtraLinks(procEnv.ADMIN_EXTRA_LINKS || env.ADMIN_EXTRA_LINKS);
  for (const e of extra) {
    let g = groups.find((x) => x.title === e.group);
    if (!g) { g = { title: e.group, links: [] }; groups.push(g); }
    g.links.push(L(e.label, e.url, e.hint));
  }

  const notSetUp = groups.reduce((n, g) => n + g.links.filter((l) => l.setup).length, 0);
  return { groups, notSetUp };
}

module.exports = { buildAdminLinks, parseExtraLinks, isSafeUrl, firebaseProjectId };
