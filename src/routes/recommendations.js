const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { validate } = require('../middleware/validator');
const recoService = require('../services/tmdb/recommendations');
const { tmdbGet } = require('../services/tmdb/client');
const { getGenreMap } = require('../services/tmdb/genres');
const { tmdbConfig } = require('../config/tmdb');
const axios = require('axios');

const router = Router();

// NOTE: This endpoint is intentionally unauthenticated since the mobile app
// already sends Firebase tokens via interceptor, but recommendations are not user-specific.
router.post(
  '/',
  validate({
    body: Joi.alternatives().try(
      Joi.object({
        media_type: Joi.string().valid('movie', 'tv').required(),
        tmdb_id: Joi.number().integer().min(1).required(),
        page: Joi.number().integer().min(1).default(1),
      }),
      Joi.object({
        title: Joi.string().trim().min(1).max(200).required(),
        top_n: Joi.number().integer().min(1).max(20).default(10),
      })
    ),
  }),
  async (req, res) => {
    if (req.body.title) {
      // Legacy mode: return list compatible with existing app
      const topN = req.body.top_n || 10;
      const search = await tmdbGet('/search/movie', { query: req.body.title, page: 1 });
      const first = (search.results || [])[0];
      if (!first?.id) return ok(res, { recommendations: [] });

      const { data } = await recoService.getRecommendations({
        media_type: 'movie',
        tmdb_id: first.id,
        page: 1,
      });
      const genreMap = await getGenreMap('movie');

      const recs = (data.results || []).slice(0, topN);
      const enriched = await Promise.all(
        recs.map(async (r) => {
          // Avoid N additional TMDB calls for external IDs; the app can use our
          // compat ID format directly and resolve it via /movies/details/:id.
          const imdbID = `tmdb:movie:${r.id}`;
          return {
            title: r.title,
            release_year: (r.release_date || '').slice(0, 4) || 'N/A',
            genres: (r.genre_ids || [])
              .map((gid) => genreMap[gid])
              .filter(Boolean)
              .join(', '),
            imdbID,
            Poster: r.poster_path ? `${tmdbConfig.imageBaseUrl}/w500${r.poster_path}` : 'N/A',
            imdbRating: r.vote_average ? String(r.vote_average.toFixed(1)) : 'N/A',
            Runtime: 'N/A',
          };
        })
      );

      return ok(res, { recommendations: enriched });
    }

    const { data, source } = await recoService.getRecommendations(req.body);
    return ok(res, data, { source });
  }
);

// External ML API endpoint (optional alternative recommendation source)
// Uses movie-reco-api.onrender.com for content-based recommendations
router.post(
  '/ml',
  validate({
    body: Joi.object({
      titles: Joi.array().items(Joi.string().trim().min(1)).min(1).max(5).required(),
      top_n: Joi.number().integer().min(1).max(20).default(10),
    }),
  }),
  async (req, res) => {
    const { titles, top_n = 10 } = req.body;

    try {
      const response = await axios.post(
        'https://movie-reco-api.onrender.com/recommend',
        { titles, top_n },
        {
          timeout: 120000, // 120s to handle cold start
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const mlData = response.data;

      // Return the raw ML API response with additional metadata
      return ok(res, {
        recommendations: mlData.recommendations || [],
        found_titles: mlData.found_titles || [],
        message: mlData.message,
        processing_time: mlData.processing_time,
        recommendation_sources: mlData.recommendation_sources,
        source: 'external_ml_api',
        note: 'First request may take ~60s due to Render cold start',
      });
    } catch (error) {
      logger.error('External ML API failed:', { error: error.message });

      // Return error with helpful message
      return res.status(503).json({
        success: false,
        error: 'External ML API temporarily unavailable',
        details: error.message,
        note: 'Use the primary /recommendations endpoint for TMDB-based recommendations',
      });
    }
  }
);

module.exports = router;
