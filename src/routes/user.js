const { Router } = require('express');
const Joi = require('joi');
const { ok } = require('../utils/helpers');
const { authMiddleware, markUserDeleted } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const { schemas } = require('../utils/validators');
const { AppError } = require('../utils/errors');
const { gamificationActionLimiter, accountDeletionLimiter } = require('../middleware/rateLimiter');
const { requireRecentLogin } = require('../middleware/recentLogin');
const accountDeletion = require('../services/user/accountDeletion');
const { logger } = require('../utils/logger');
const profileService = require('../services/user/profile');
const favoritesService = require('../services/user/favorites');
const watchlistsService = require('../services/user/watchlists');
const episodesService = require('../services/user/episodes');
const gamificationService = require('../services/user/gamification');
const watchedTitlesService = require('../services/user/watchedTitles');

const router = Router();

function requireIdempotencyKey(req) {
  const key = req.headers['x-idempotency-key'];
  const normalized = gamificationService.sanitizeIdempotencyKey(key);
  if (!normalized) {
    throw new AppError('Missing or invalid X-Idempotency-Key header', 400, 'VALIDATION_ERROR');
  }
  return normalized;
}

// Best-effort XP for a title that is now watched. A failure here must never fail the watch itself.
async function awardTitleXp(uid, contentId, req) {
  try {
    const key = gamificationService.sanitizeIdempotencyKey(req.headers['x-idempotency-key']);
    return await gamificationService.recordWatchTitle(uid, contentId, { idempotencyKey: key });
  } catch (err) {
    logger.warn('Title XP award skipped', { contentId, message: err.message });
    return null;
  }
}

// Keep the per-title watched record in step with a watchlist toggle. Never fails the toggle.
async function mirrorToTitleRecord(uid, listName, ident, watched) {
  try {
    await watchedTitlesService.mirrorListToggle(uid, listName, ident, watched);
  } catch (err) {
    logger.warn('Watched record mirror skipped', { listName, message: err.message });
  }
}

const titleMetaSchema = Joi.object({
  title: Joi.string().trim().max(200).allow(''),
  poster: Joi.string().trim().max(500).allow(''),
  year: Joi.string().trim().max(12).allow(''),
  totalEpisodes: Joi.number().integer().min(0).max(100000),
  totalSeasons: Joi.number().integer().min(0).max(1000),
  seasonCounts: Joi.object().pattern(/^\d{1,3}$/, Joi.number().integer().min(0).max(100000)).max(200),
}).unknown(false);

function logLegacyWatchlistRoute(req, _res, next) {
  logger.warn('Legacy watchlist route used; prefer /watchlists/:name/items', {
    method: req.method,
    path: req.originalUrl,
  });
  return next();
}

// Make sure the profile document exists. Once confirmed it is remembered for 10 minutes per user,
// so a busy session does not pay a Firestore read on every request.
const PROFILE_CHECK_TTL_MS = 10 * 60 * 1000;
const PROFILE_CHECK_MAX = 5000;
const profileChecked = new Map(); // uid -> expires at (ms)

router.use(authMiddleware);
router.use(async (req, _res, next) => {
  const { uid } = req.user;
  const until = profileChecked.get(uid);
  if (until && until > Date.now()) return next();

  await profileService.ensureProfile(uid, {
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
  });

  if (profileChecked.size >= PROFILE_CHECK_MAX) {
    const now = Date.now();
    for (const [k, exp] of profileChecked) if (exp <= now) profileChecked.delete(k);
    if (profileChecked.size >= PROFILE_CHECK_MAX) profileChecked.clear();
  }
  profileChecked.set(uid, Date.now() + PROFILE_CHECK_TTL_MS);
  return next();
});

// Permanent. Needs a sign-in from the last 5 minutes and an explicit confirmation.
router.delete(
  '/account',
  accountDeletionLimiter,
  validate({ body: Joi.object({ confirm: Joi.string().valid('DELETE').required() }) }),
  requireRecentLogin({ maxAgeSeconds: 300 }),
  async (req, res) => {
    const summary = await accountDeletion.deleteAccount(req.user.uid);
    profileChecked.delete(req.user.uid);
    await markUserDeleted(req.user.uid); // reject this person's still-valid tokens from now on
    return ok(res, { deleted: true, ...summary });
  }
);

router.get('/profile', async (req, res) => {
  const data = await profileService.getProfile(req.user.uid);
  return ok(res, data);
});

router.put(
  '/profile',
  validate({
    body: Joi.object({
      username: Joi.string().trim().min(1).max(64).optional(),
      // Free-form, but bounded: at most 50 keys and 8 KB, so one user cannot fill a document.
      preferences: Joi.object()
        .max(50)
        .custom((value, helpers) =>
          Buffer.byteLength(JSON.stringify(value), 'utf8') > 8192 ? helpers.error('any.invalid') : value
        )
        .messages({ 'any.invalid': 'preferences is too large' })
        .optional(),
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
  logLegacyWatchlistRoute,
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
  logLegacyWatchlistRoute,
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
    await mirrorToTitleRecord(req.user.uid, req.params.name, req.params.imdbID, data.watched);
    return ok(res, data);
  }
);

// Legacy: remove a movie by imdbID (supports tt* and tmdb:*)
router.delete(
  '/watchlists/:name/movies/:imdbID',
  logLegacyWatchlistRoute,
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
    await mirrorToTitleRecord(req.user.uid, req.params.name, req.params.tmdb_id, data.watched);
    return ok(res, data);
  }
);

router.get('/gamification', async (req, res) => {
  const data = (await profileService.getGamification(req.user.uid)) || gamificationService.defaultState();
  return ok(res, { gamification: data });
});

router.post(
  '/gamification/actions/watch',
  gamificationActionLimiter,
  validate({
    body: Joi.object({
      movieId: Joi.string().trim().min(1).max(120).required(),
      listName: Joi.string().trim().min(1).max(100).required(),
    }),
  }),
  async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const data = await gamificationService.recordWatch(req.user.uid, req.body.movieId, req.body.listName, {
      idempotencyKey,
    });
    return ok(res, data);
  }
);

router.post(
  '/gamification/actions/list-created',
  gamificationActionLimiter,
  validate({
    body: Joi.object({
      listName: Joi.string().trim().min(1).max(100).required(),
    }),
  }),
  async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const data = await gamificationService.recordListCreated(req.user.uid, req.body.listName, {
      idempotencyKey,
    });
    return ok(res, data);
  }
);

router.post(
  '/gamification/actions/list-completed',
  gamificationActionLimiter,
  validate({
    body: Joi.object({
      listName: Joi.string().trim().min(1).max(100).required(),
    }),
  }),
  async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const data = await gamificationService.recordListCompleted(req.user.uid, req.body.listName, {
      idempotencyKey,
    });
    return ok(res, data);
  }
);

router.put(
  '/gamification',
  validate({
    body: Joi.object({}).unknown(true),
  }),
  async (_req, _res) => {
    throw new AppError(
      'Direct gamification sync is disabled. Use action endpoints.',
      410,
      'GAMIFICATION_SYNC_DISABLED'
    );
  }
);

// Everything the user has watched (movies, finished series, series in progress).
router.get('/watched', async (req, res) => {
  const data = await watchedTitlesService.listWatchedTitles(req.user.uid);
  return ok(res, data);
});

router.get(
  '/watched/:contentId',
  validate({
    params: Joi.object({ contentId: Joi.string().trim().min(1).required() }),
  }),
  async (req, res) => {
    const episodes = await episodesService.getWatchedEpisodes(req.user.uid, req.params.contentId);
    return ok(res, { episodes });
  }
);

router.patch(
  '/watched/:contentId/episodes',
  validate({
    params: Joi.object({ contentId: Joi.string().trim().min(1).required() }),
    body: Joi.object({
      season: Joi.number().integer().min(0).required(),
      episode: Joi.number().integer().min(1).required(),
      watched: Joi.boolean().required(),
      meta: titleMetaSchema.optional(),
    }),
  }),
  async (req, res) => {
    const { uid } = req.user;
    const { contentId } = req.params;
    const data = await episodesService.setEpisodeWatched(
      uid,
      contentId,
      req.body.season,
      req.body.episode,
      req.body.watched
    );
    // Remember title info, and notice when the last episode completes the series.
    let title = null;
    try {
      title = await watchedTitlesService.afterEpisodeChange(uid, contentId, {
        watched: req.body.watched,
        meta: req.body.meta,
      });
    } catch (err) {
      logger.warn('Episode follow-up skipped', { contentId, message: err.message });
    }
    const xp = title && title.justCompleted ? await awardTitleXp(uid, contentId, req) : null;
    return ok(res, { episodes: data, title: title && title.summary, completed: !!(title && title.completed), xp });
  }
);

// Is this title watched? (movie: flag. series: flag or every episode ticked.)
router.get(
  '/watched/:contentId/title',
  validate({ params: Joi.object({ contentId: Joi.string().trim().min(1).max(120).required() }) }),
  async (req, res) => {
    const data = await watchedTitlesService.getTitleState(req.user.uid, req.params.contentId);
    return ok(res, data);
  }
);

// Mark a whole movie or series watched / unwatched, with or without a watchlist.
router.put(
  '/watched/:contentId/title',
  validate({
    params: Joi.object({ contentId: Joi.string().trim().min(1).max(120).required() }),
    body: Joi.object({
      type: Joi.string().valid('movie', 'series', 'tv').required(),
      watched: Joi.boolean().required(),
      meta: titleMetaSchema.optional(),
      // Series only: every episode to tick when marking the whole series watched.
      episodes: Joi.array()
        .items(
          Joi.object({
            season: Joi.number().integer().min(0).required(),
            episode: Joi.number().integer().min(1).required(),
          })
        )
        .max(watchedTitlesService.MAX_BULK_EPISODES)
        .optional(),
    }),
  }),
  async (req, res) => {
    const { uid } = req.user;
    const { contentId } = req.params;
    const data = await watchedTitlesService.setTitleWatched(uid, contentId, req.body);
    const xp = req.body.watched ? await awardTitleXp(uid, contentId, req) : null;
    return ok(res, { ...data, xp });
  }
);

module.exports = router;
