const { env } = require('./environment');

const tmdbConfig = {
  apiKey: env.TMDB_API_KEY,
  baseUrl: env.TMDB_BASE_URL,
  imageBaseUrl: env.TMDB_IMAGE_BASE_URL,
};

module.exports = { tmdbConfig };
