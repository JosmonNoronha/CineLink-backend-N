// Lifecycle of the shared Redis client (see src/config/redis.js).
process.env.REDIS_CONNECT_TIMEOUT_MS = '60';

const mockEvents = require('events');

const mockEnv = { REDIS_URL: '' };
const mockWarn = jest.fn();
let mockClients = [];
let mockConnectBehaviour = 'resolve'; // resolve | pending

jest.mock('../src/config/environment', () => ({ env: mockEnv }));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: (...a) => mockWarn(...a), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('redis', () => ({
  createClient: jest.fn((options) => {
    const c = new mockEvents();
    c.options = options;
    c.isReady = false;
    c.quit = jest.fn();
    c.disconnect = jest.fn();
    c.connect = jest.fn(() => {
      if (mockConnectBehaviour === 'pending') return new Promise(() => {});
      c.isReady = true;
      c.emit('ready');
      return Promise.resolve();
    });
    mockClients.push(c);
    return c;
  }),
}));

const loadRedis = () => {
  jest.resetModules();
  mockClients = [];
  mockWarn.mockClear();
  return require('../src/config/redis');
};

describe('redis client lifecycle', () => {
  beforeEach(() => {
    mockEnv.REDIS_URL = 'rediss://default:secret@example.upstash.io:6379';
    mockConnectBehaviour = 'resolve';
  });

  test('does nothing without REDIS_URL', async () => {
    mockEnv.REDIS_URL = '';
    const r = loadRedis();
    await expect(r.initializeRedis()).resolves.toBeNull();
    expect(mockClients).toHaveLength(0);
    expect(r.isRedisReady()).toBe(false);
    expect(r.getRedisClient()).toBeNull();
  });

  test('creates ONE client that reconnects by itself and fails fast while down', async () => {
    const r = loadRedis();
    const client = await r.initializeRedis();
    expect(mockClients).toHaveLength(1);
    expect(client).toBe(mockClients[0]);

    const { socket, disableOfflineQueue } = client.options;
    expect(disableOfflineQueue).toBe(true);
    expect(typeof socket.reconnectStrategy).toBe('function'); // not `false`
    for (const retries of [0, 1, 5, 20, 1000]) {
      const wait = socket.reconnectStrategy(retries);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(15_250); // capped, never gives up
    }
  });

  test('the same client is used after a drop and recovery', async () => {
    const r = loadRedis();
    const client = await r.initializeRedis();
    expect(r.getRedisClient()).toBe(client);

    client.isReady = false; // socket dropped
    client.emit('error', new Error('Socket closed unexpectedly'));
    expect(r.isRedisReady()).toBe(false);
    expect(r.getRedisClient()).toBeNull();

    client.isReady = true; // node-redis reconnected the same object
    client.emit('ready');
    expect(r.getRedisClient()).toBe(client);
    expect(mockClients).toHaveLength(1); // never replaced
  });

  test('a slow first connection does not block start-up or kill the client', async () => {
    mockConnectBehaviour = 'pending';
    const r = loadRedis();
    await expect(r.initializeRedis()).resolves.toBeNull();
    expect(r.isRedisReady()).toBe(false);
    expect(mockClients[0].disconnect).not.toHaveBeenCalled();

    mockClients[0].isReady = true; // it connects later in the background
    mockClients[0].emit('ready');
    expect(r.getRedisClient()).toBe(mockClients[0]);
  });

  test('markRedisUnavailable (a failed command) does not disconnect anything', async () => {
    const r = loadRedis();
    const client = await r.initializeRedis();
    r.markRedisUnavailable('command-error');
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.quit).not.toHaveBeenCalled();
    expect(r.getRedisClient()).toBe(client);
    expect(mockClients).toHaveLength(1);
  });

  test('error logs are throttled and the password never appears in logs', async () => {
    const r = loadRedis();
    const client = await r.initializeRedis();
    mockWarn.mockClear();
    for (let i = 0; i < 50; i += 1) client.emit('error', new Error('ECONNRESET'));
    expect(mockWarn.mock.calls.filter(([m]) => /Redis error/.test(m))).toHaveLength(1);
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('secret');
  });

  test('warns when a hosted address has no TLS', async () => {
    mockEnv.REDIS_URL = 'redis://default:pw@example.upstash.io:6379';
    const r = loadRedis();
    await r.initializeRedis();
    expect(mockWarn.mock.calls.some(([m]) => /needs rediss/.test(m))).toBe(true);
  });
});
