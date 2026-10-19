'use strict';

const { requireOpsAuth, hasValidOpsCredential, getOpsSecret } = require('./opsAuth');
const { logger } = require('../utils/logger');

const STATUS_MONITOR_PATH = '/status-monitor';

/** Off unless explicitly enabled AND a secret exists. Never in tests. */
function isStatusMonitorEnabled(env) {
  return env.NODE_ENV !== 'test' && env.STATUS_MONITOR_ENABLED === true && Boolean(getOpsSecret());
}

/** Guard for the dashboard page. Must be mounted BEFORE the monitor middleware. */
function mountStatusMonitorGate(app, path = STATUS_MONITOR_PATH) {
  app.use(path, ...requireOpsAuth({ challenge: true, name: 'Status monitor' }));
}

function mountStatusMonitor(app, env) {
  if (!isStatusMonitorEnabled(env)) {
    if (env.STATUS_MONITOR_ENABLED === true && !getOpsSecret()) {
      logger.warn('STATUS_MONITOR_ENABLED=true ignored: set OPS_SECRET to protect the dashboard');
    }
    return false;
  }

  mountStatusMonitorGate(app);

  const statusMonitor = require('express-status-monitor');
  app.use(
    statusMonitor({
      title: 'CineLink API Status',
      path: STATUS_MONITOR_PATH,
      // The live stats stream is a socket.io connection that bypasses Express middleware,
      // so it needs its own check. Browsers resend the cached Basic credentials on it.
      authorize: async (socket) => hasValidOpsCredential(socket.handshake && socket.handshake.headers),
      spans: [
        { interval: 1, retention: 60 },
        { interval: 5, retention: 60 },
        { interval: 15, retention: 60 },
      ],
      chartVisibility: { cpu: true, mem: true, load: true, responseTime: true, rps: true, statusCodes: true },
      healthChecks: [{ protocol: 'http', host: 'localhost', path: '/api/health', port: env.PORT }],
    })
  );
  return true;
}

module.exports = { mountStatusMonitor, mountStatusMonitorGate, isStatusMonitorEnabled, STATUS_MONITOR_PATH };
