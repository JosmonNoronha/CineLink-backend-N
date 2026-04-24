const { AsyncLocalStorage } = require('async_hooks');

const requestContextStorage = new AsyncLocalStorage();

function runWithRequestContext(context, callback) {
  return requestContextStorage.run(context, callback);
}

function getRequestContext() {
  return requestContextStorage.getStore() || null;
}

module.exports = {
  runWithRequestContext,
  getRequestContext,
};
