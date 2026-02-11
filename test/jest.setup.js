process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.API_PREFIX = process.env.API_PREFIX || '/api';

// Required by backend env validation
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

// Keep CORS permissive for tests
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '';
