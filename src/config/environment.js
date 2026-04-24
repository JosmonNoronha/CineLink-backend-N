const dotenv = require('dotenv');
const Joi = require('joi');
const path = require('path');
const fs = require('fs');

const isJestRuntime = Boolean(process.env.JEST_WORKER_ID);
if (!isJestRuntime) {
  dotenv.config();
}

function failEnvironmentValidation(message, details = []) {
  // In tests, throw so assertions can verify validation behavior.
  if (process.env.NODE_ENV === 'test') {
    const error = new Error([message, ...details].join('\n'));
    error.name = 'EnvironmentValidationError';
    throw error;
  }

  // eslint-disable-next-line no-console
  console.error(message);
  details.forEach((detail) => {
    // eslint-disable-next-line no-console
    console.error(detail);
  });
  process.exit(1);
}

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(5001),
  API_PREFIX: Joi.string().default('/api'),
  CORS_ORIGIN: Joi.string().allow('').default(''),

  TMDB_API_KEY: Joi.string().required(),
  TMDB_BASE_URL: Joi.string().uri().default('https://api.themoviedb.org/3'),
  TMDB_IMAGE_BASE_URL: Joi.string().uri().default('https://image.tmdb.org/t/p'),

  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().allow(''),
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: Joi.string().allow(''),
  FIREBASE_SERVICE_ACCOUNT_JSON_PATH: Joi.string().allow(''),
  FIREBASE_PROJECT_ID: Joi.string().allow(''),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow(''),
  FIREBASE_PRIVATE_KEY: Joi.string().allow(''),

  REDIS_URL: Joi.string().allow('').optional(),

  RATE_LIMIT_WINDOW_MS: Joi.number().default(60_000),
  RATE_LIMIT_MAX: Joi.number().default(120),
  SEARCH_RATE_LIMIT_MAX: Joi.number().default(40),

  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').default('info'),

  SENTRY_DSN: Joi.string().uri().allow(''),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0),
}).unknown(true);

const { value, error } = schema.validate(process.env, { abortEarly: false });
if (error) {
  failEnvironmentValidation(
    '❌ Environment validation error:',
    error.details.map((detail) => `   - ${detail.message}`)
  );
}

// Validate Firebase credentials - at least one method must be provided
function validateFirebaseCredentials(env) {
  const hasJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const hasBase64 = env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const hasPath = env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH;
  const hasDiscreteVars = env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY;

  if (!hasJson && !hasBase64 && !hasPath && !hasDiscreteVars) {
    throw new Error(
      'Firebase credentials not configured. Provide ONE of:\n' +
        '  1. FIREBASE_SERVICE_ACCOUNT_JSON (JSON string)\n' +
        '  2. FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (base64-encoded JSON)\n' +
        '  3. FIREBASE_SERVICE_ACCOUNT_JSON_PATH (path to JSON file)\n' +
        '  4. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY'
    );
  }

  // If using path, verify file exists
  if (hasPath && !fs.existsSync(hasPath)) {
    throw new Error(`Firebase service account file not found: ${path.resolve(hasPath)}`);
  }

  // In production, require Firebase configuration
  if (env.NODE_ENV === 'production' && !hasJson && !hasBase64 && !hasPath && !hasDiscreteVars) {
    throw new Error('Firebase credentials REQUIRED in production environment');
  }
}

// Validate environment-specific requirements
function validateEnvironmentRequirements(env) {
  // Ensure TMDB API key is likely valid in every environment.
  if (env.TMDB_API_KEY && env.TMDB_API_KEY.length < 20) {
    throw new Error('TMDB_API_KEY appears to be invalid (too short)');
  }

  if (env.NODE_ENV === 'production') {
    if (!env.SENTRY_DSN) {
      // eslint-disable-next-line no-console
      console.warn('⚠️  Warning: SENTRY_DSN not configured in production - error tracking disabled');
    }

    if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'silly') {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  Warning: LOG_LEVEL=${env.LOG_LEVEL} in production may impact performance`);
    }
  }

  // CORS origin validation
  if (env.CORS_ORIGIN.length === 0 && env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.warn('⚠️  Warning: CORS_ORIGIN is empty - all origins allowed (security risk in production)');
  }
}

try {
  validateFirebaseCredentials(value);
  validateEnvironmentRequirements(value);
} catch (validationError) {
  failEnvironmentValidation('❌ Environment validation failed:', [`   ${validationError.message}`]);
}

const env = {
  NODE_ENV: value.NODE_ENV,
  PORT: value.PORT,
  API_PREFIX: value.API_PREFIX,
  CORS_ORIGIN: (value.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  TMDB_API_KEY: value.TMDB_API_KEY,
  TMDB_BASE_URL: value.TMDB_BASE_URL,
  TMDB_IMAGE_BASE_URL: value.TMDB_IMAGE_BASE_URL,

  FIREBASE_SERVICE_ACCOUNT_JSON: value.FIREBASE_SERVICE_ACCOUNT_JSON,
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: value.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
  FIREBASE_SERVICE_ACCOUNT_JSON_PATH: value.FIREBASE_SERVICE_ACCOUNT_JSON_PATH,
  FIREBASE_PROJECT_ID: value.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: value.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: value.FIREBASE_PRIVATE_KEY,

  REDIS_URL: value.REDIS_URL,

  RATE_LIMIT_WINDOW_MS: value.RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX: value.RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_MAX: value.SEARCH_RATE_LIMIT_MAX,

  LOG_LEVEL: value.LOG_LEVEL,

  SENTRY_DSN: value.SENTRY_DSN,
  SENTRY_TRACES_SAMPLE_RATE: value.SENTRY_TRACES_SAMPLE_RATE,
};

module.exports = { env };
