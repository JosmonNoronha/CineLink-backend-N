const Joi = require('joi');

const schemas = {
  tmdbItem: Joi.object({
    tmdb_id: Joi.number().integer().min(1).required(),
    media_type: Joi.string().valid('movie', 'tv').required(),
    metadata: Joi.object().optional(),
  }),

  // Legacy OMDb-like movie object used by current mobile app
  omdbMovie: Joi.object({
    imdbID: Joi.string().trim().min(1).required(),
    Title: Joi.string().allow('', null).optional(),
    Year: Joi.string().allow('', null).optional(),
    Type: Joi.string().allow('', null).optional(),
    Poster: Joi.string().allow('', null).optional(),
  }).unknown(true),

  watchlistCreate: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    description: Joi.string().trim().max(500).optional(),
  }),
};

module.exports = { schemas };
