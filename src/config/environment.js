const dotenv = require('dotenv');
const Joi = require('joi');

dotenv.config();

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
  // eslint-disable-next-line no-console
  console.error('Environment validation error:', error.message);
  process.exit(1);
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
