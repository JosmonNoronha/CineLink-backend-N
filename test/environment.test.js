const fs = require('fs');
const path = require('path');

describe('Environment Validation', () => {
  // Save original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules and env before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('required TMDB_API_KEY', () => {
    it('fails if TMDB_API_KEY is missing', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TMDB_API_KEY;

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).toThrow();
    });

    it('passes if TMDB_API_KEY is provided', () => {
      process.env.NODE_ENV = 'test';
      process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'test-key';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).not.toThrow();
    });
  });

  describe('Firebase credential validation', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
    });

    it('fails if no Firebase credentials provided', () => {
      // Clear all Firebase env vars
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH;
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).toThrow(/Firebase credentials not configured/);
    });

    it('passes if Firebase discrete vars provided', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'test-key';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).not.toThrow();
    });

    it('passes if Firebase service account JSON provided', () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account"}';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).not.toThrow();
    });

    it('fails if Firebase service account file path does not exist', () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH = '/nonexistent/path/to/service-account.json';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).toThrow(/Firebase service account file not found/);
    });

    it('passes if Firebase service account file exists', () => {
      // Create temp file
      const tempFile = path.join(__dirname, 'temp-service-account.json');
      fs.writeFileSync(tempFile, '{"type":"service_account"}');

      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH = tempFile;

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).not.toThrow();

      // Cleanup
      fs.unlinkSync(tempFile);
    });
  });

  describe('environment-specific validation', () => {
    beforeEach(() => {
      process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'test-key';
    });

    it('allows debug logging in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.LOG_LEVEL = 'debug';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).not.toThrow();
    });

    it('fails if TMDB_API_KEY is too short', () => {
      process.env.TMDB_API_KEY = 'short-key';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).toThrow(/TMDB_API_KEY appears to be invalid/);
    });
  });

  describe('CORS origin parsing', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'test-key';
    });

    it('parses comma-separated CORS origins', () => {
      process.env.CORS_ORIGIN = 'http://localhost:3000,http://localhost:8081';

      // eslint-disable-next-line global-require
      const { env } = require('../src/config/environment');

      expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000', 'http://localhost:8081']);
    });

    it('trims whitespace from CORS origins', () => {
      process.env.CORS_ORIGIN = 'http://localhost:3000 , http://localhost:8081 ';

      // eslint-disable-next-line global-require
      const { env } = require('../src/config/environment');

      expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000', 'http://localhost:8081']);
    });

    it('filters empty CORS origins', () => {
      process.env.CORS_ORIGIN = 'http://localhost:3000,,http://localhost:8081';

      // eslint-disable-next-line global-require
      const { env } = require('../src/config/environment');

      expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000', 'http://localhost:8081']);
    });
  });

  describe('port validation', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'test-key';
    });

    it('uses default port if not provided', () => {
      delete process.env.PORT;

      // eslint-disable-next-line global-require
      const { env } = require('../src/config/environment');

      expect(env.PORT).toBe(5001);
    });

    it('accepts custom port', () => {
      process.env.PORT = '3000';

      // eslint-disable-next-line global-require
      const { env } = require('../src/config/environment');

      expect(env.PORT).toBe(3000);
    });

    it('rejects invalid port', () => {
      process.env.PORT = '99999';

      expect(() => {
        // eslint-disable-next-line global-require
        require('../src/config/environment');
      }).toThrow();
    });
  });

  describe('defaults and defaults', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.TMDB_API_KEY = 'test-key-valid-length-more-than-20-chars';
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'test-key';
    });

    it('applies default values for optional fields', () => {
      // eslint-disable-next-line global-require
      const { env } = require('../src/config/environment');

      expect(env.RATE_LIMIT_WINDOW_MS).toBe(60000);
      expect(env.RATE_LIMIT_MAX).toBe(120);
      expect(env.SEARCH_RATE_LIMIT_MAX).toBe(40);
      expect(env.LOG_LEVEL).toBe('info');
      expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
    });
  });
});
