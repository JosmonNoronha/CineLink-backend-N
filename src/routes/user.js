const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { schemas } = require('../utils/validators');
const profileService = require('../services/user/profile');
const favoritesService = require('../services/user/favorites');
const watchlistsService = require('../services/user/watchlists');

const router = Router();

router.use(authMiddleware);

router.get('/profile', async (req, res) => {
  const data = await profileService.getProfile(req.user.uid);
  return ok(res, data);
});

router.put(
  '/profile',
  validate({
    body: Joi.object({
      username: Joi.string().trim().min(1).max(64).optional(),
      preferences: Joi.object().optional(),
    }),
  }),
  async (req, res) => {
    const data = await profileService.upsertProfile(req.user.uid, req.body);
    return ok(res, data);
  }
);

router.get('/favorites', async (req, res) => {
  const data = await favoritesService.listFavorites(req.user.uid);
  return ok(res, data);
});

router.post(
  '/favorites',
  validate({
    body: Joi.alternatives().try(schemas.tmdbItem, Joi.object({ movie: schemas.omdbMovie.required() })),
  }),
  async (req, res) => {
    if (req.body.movie) {
      const data = await favoritesService.addFavoriteLegacy(req.user.uid, req.body.movie);
      return ok(res, data);
    }
    const data = await favoritesService.addFavorite(req.user.uid, req.body);
    return ok(res, data);
  }
);

router.delete(
  '/favorites/:tmdb_id',
  validate({ params: Joi.object({ tmdb_id: Joi.string().trim().min(1).required() }) }),
  async (req, res) => {
    const id = req.params.tmdb_id;
    const data =
      id.startsWith('tt') || id.startsWith('tmdb:')
        ? await favoritesService.removeFavoriteLegacy(req.user.uid, id)
        : await favoritesService.removeFavorite(req.user.uid, id);
    return ok(res, data);
  }
);

router.get('/watchlists', async (req, res) => {
  const data = await watchlistsService.listWatchlists(req.user.uid);
  return ok(res, data);
});

router.post('/watchlists', validate({ body: schemas.watchlistCreate }), async (req, res) => {
  const data = await watchlistsService.createWatchlist(req.user.uid, req.body);
  return ok(res, data);
});

// Legacy: add a movie object to a watchlist (current app expects this)
router.post(
  '/watchlists/:name/movies',
  validate({
    params: Joi.object({ name: Joi.string().trim().min(1).max(100).required() }),
    body: Joi.object({ movie: schemas.omdbMovie.required() }),
  }),
  async (req, res) => {
    const data = await watchlistsService.addMovieLegacy(req.user.uid, req.params.name, req.body.movie);
    return ok(res, data);
  }
);

// Legacy: toggle watched by imdbID
router.patch(
  '/watchlists/:name/movies/:imdbID/watched',
  validate({
    params: Joi.object({
      name: Joi.string().trim().min(1).max(100).required(),
      imdbID: Joi.string().trim().min(1).required(),
    }),
  }),
  async (req, res) => {
    const data = await watchlistsService.toggleWatchedLegacy(
      req.user.uid,
      req.params.name,
      req.params.imdbID
    );
    return ok(res, data);
  }
);

// Legacy: remove a movie by imdbID (supports tt* and tmdb:*)
router.delete(
  '/watchlists/:name/movies/:imdbID',
  validate({
    params: Joi.object({
      name: Joi.string().trim().min(1).max(100).required(),
      imdbID: Joi.string().trim().min(1).required(),
    }),
  }),
  async (req, res) => {
    const data = await watchlistsService.removeMovieLegacy(req.user.uid, req.params.name, req.params.imdbID);
    return ok(res, data);
  }
);

router.get(
  '/watchlists/:name',
  validate({ params: Joi.object({ name: Joi.string().trim().min(1).max(100).required() }) }),
  async (req, res) => {
    const data = await watchlistsService.getWatchlist(req.user.uid, req.params.name);
    return ok(res, data);
  }
);

router.delete(
  '/watchlists/:name',
  validate({ params: Joi.object({ name: Joi.string().trim().min(1).max(100).required() }) }),
  async (req, res) => {
    const data = await watchlistsService.deleteWatchlist(req.user.uid, req.params.name);
    return ok(res, data);
  }
);

// Streaming subscriptions
router.get('/subscriptions', async (req, res) => {
  const data = await profileService.getSubscriptions(req.user.uid);
  return ok(res, { subscriptions: data });
});

router.put(
  '/subscriptions',
  validate({
    body: Joi.object({
      subscriptions: Joi.array().items(Joi.number().integer().min(1)).required(),
    }),
  }),
  async (req, res) => {
    const data = await profileService.updateSubscriptions(req.user.uid, req.body.subscriptions);
    return ok(res, data);
  }
);

router.post(
  '/watchlists/:name/items',
  validate({
    params: Joi.object({ name: Joi.string().trim().min(1).max(100).required() }),
    body: schemas.tmdbItem,
  }),
  async (req, res) => {
    const data = await watchlistsService.addItem(req.user.uid, req.params.name, req.body);
    return ok(res, data);
  }
);

router.delete(
  '/watchlists/:name/items/:tmdb_id',
  validate({
    params: Joi.object({
      name: Joi.string().trim().min(1).max(100).required(),
      tmdb_id: Joi.number().integer().min(1).required(),
    }),
  }),
  async (req, res) => {
    const data = await watchlistsService.removeItem(req.user.uid, req.params.name, req.params.tmdb_id);
    return ok(res, data);
  }
);

router.patch(
  '/watchlists/:name/items/:tmdb_id/watched',
  validate({
    params: Joi.object({
      name: Joi.string().trim().min(1).max(100).required(),
      tmdb_id: Joi.number().integer().min(1).required(),
    }),
  }),
  async (req, res) => {
    const data = await watchlistsService.toggleWatched(req.user.uid, req.params.name, req.params.tmdb_id);
    return ok(res, data);
  }
);

module.exports = router;
