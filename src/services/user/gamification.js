const admin = require('firebase-admin');
const { getFirestore } = require('../../config/firebase');
const { AppError } = require('../../utils/errors');

const XP_PER_WATCH = 25;
const XP_PER_LIST_COMPLETE = 100;
const XP_PER_LIST_CREATE = 15;
const XP_STREAK_BONUS = 10;
const MAX_REWARDED_LIST_CREATES = 5;

const LIMITS = {
  watchedMovieIds: 5000,
  completedListNames: 2000,
  rewardedCreatedListNames: 2000,
  unlockedAchievements: 200,
};

const LEVELS = [
  { level: 1, title: 'Newbie', xpNeeded: 0, icon: '🍿' },
  { level: 2, title: 'Movie Buff', xpNeeded: 50, icon: '🎬' },
  { level: 3, title: 'Cinephile', xpNeeded: 150, icon: '🎥' },
  { level: 4, title: 'Film Critic', xpNeeded: 350, icon: '⭐' },
  { level: 5, title: "Director's Cut", xpNeeded: 600, icon: '🏆' },
  { level: 6, title: 'Oscar Worthy', xpNeeded: 1000, icon: '🌟' },
  { level: 7, title: 'Hall of Fame', xpNeeded: 1500, icon: '👑' },
  { level: 8, title: 'Legend', xpNeeded: 2500, icon: '💎' },
];

const ACHIEVEMENTS = [
  { id: 'first_watch', title: 'First Watch', desc: 'Mark your first title as watched', icon: 'eye-outline', condition: (s) => s.totalWatched >= 1 },
  { id: 'five_watched', title: 'Popcorn Time', desc: 'Watch 5 movies or shows', icon: 'film-outline', condition: (s) => s.totalWatched >= 5 },
  { id: 'ten_watched', title: 'Movie Marathon', desc: 'Watch 10 titles', icon: 'play-circle-outline', condition: (s) => s.totalWatched >= 10 },
  { id: 'twentyfive_watched', title: 'Binge Master', desc: 'Watch 25 titles', icon: 'tv-outline', condition: (s) => s.totalWatched >= 25 },
  { id: 'fifty_watched', title: 'Half Century', desc: 'Watch 50 titles', icon: 'medal-outline', condition: (s) => s.totalWatched >= 50 },
  { id: 'hundred_watched', title: 'Centurion', desc: 'Watch 100 titles', icon: 'trophy-outline', condition: (s) => s.totalWatched >= 100 },
  { id: 'first_list', title: 'Organizer', desc: 'Create your first watchlist', icon: 'list-outline', condition: (s) => s.listsCreated >= 1 },
  { id: 'three_lists', title: 'Curator', desc: 'Create 3 watchlists', icon: 'layers-outline', condition: (s) => s.listsCreated >= 3 },
  { id: 'five_lists', title: 'Archivist', desc: 'Create 5 watchlists', icon: 'library-outline', condition: (s) => s.listsCreated >= 5 },
  { id: 'first_complete', title: 'Completionist', desc: 'Complete your first watchlist', icon: 'checkmark-circle-outline', condition: (s) => s.listsCompleted >= 1 },
  { id: 'three_complete', title: 'Perfectionist', desc: 'Complete 3 watchlists', icon: 'ribbon-outline', condition: (s) => s.listsCompleted >= 3 },
  { id: 'five_complete', title: 'Overclocker', desc: 'Complete 5 watchlists', icon: 'flash-outline', condition: (s) => s.listsCompleted >= 5 },
  { id: 'streak_3', title: 'On a Roll', desc: '3-day watch streak', icon: 'flame-outline', condition: (s) => s.bestStreak >= 3 },
  { id: 'streak_7', title: 'Week Warrior', desc: '7-day watch streak', icon: 'thunderstorm-outline', condition: (s) => s.bestStreak >= 7 },
  { id: 'streak_14', title: 'Unstoppable', desc: '14-day watch streak', icon: 'barbell-outline', condition: (s) => s.bestStreak >= 14 },
  { id: 'streak_30', title: 'Cinematic Life', desc: '30-day watch streak', icon: 'moon-outline', condition: (s) => s.bestStreak >= 30 },
  { id: 'daily_double', title: 'Double Feature', desc: 'Watch 2 titles in a single day', icon: 'albums-outline', condition: (s) => Object.values(s.dailyWatchCounts || {}).some((c) => c >= 2) },
  { id: 'triple_feature', title: 'Triple Feature', desc: 'Watch 3 titles in a single day', icon: 'grid-outline', condition: (s) => Object.values(s.dailyWatchCounts || {}).some((c) => c >= 3) },
  { id: 'weekly_binge', title: 'Weekend Warrior', desc: 'Watch 5 titles in a single week', icon: 'calendar-outline', condition: (s) => Object.values(s.weeklyWatchCounts || {}).some((c) => c >= 5) },
  { id: 'weekly_marathon', title: 'Non-Stop', desc: 'Watch 10 titles in a single week', icon: 'rocket-outline', condition: (s) => Object.values(s.weeklyWatchCounts || {}).some((c) => c >= 10) },
];

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

const defaultState = () => ({
  xp: 0,
  totalWatched: 0,
  listsCreated: 0,
  listsCompleted: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastWatchDate: null,
  unlockedAchievements: [],
  watchedMovieIds: [],
  completedListNames: [],
  rewardedCreatedListNames: [],
  dailyWatchCounts: {},
  weeklyWatchCounts: {},
});

function userDocRef(uid) {
  return getFirestore().collection('users').doc(uid);
}

function watchlistDocRef(uid, listName) {
  return getFirestore().collection('users').doc(uid).collection('watchlists').doc(listName);
}

function gamificationEventDocRef(uid, actionType, idempotencyKey) {
  return getFirestore()
    .collection('users')
    .doc(uid)
    .collection('gamificationEvents')
    .doc(`${actionType}:${idempotencyKey}`);
}

function sanitizeIdempotencyKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 96);
  return cleaned || null;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqStrings(values, maxLen) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const v = String(raw || '').trim();
    if (!v || seen.has(v)) continue;
    out.push(v);
    seen.add(v);
    if (out.length >= maxLen) break;
  }
  return out;
}

function clampCounts(map) {
  const out = {};
  const src = map && typeof map === 'object' ? map : {};
  for (const [k, v] of Object.entries(src)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    out[String(k)] = Math.floor(n);
  }
  return out;
}

function normalizeState(raw) {
  const base = defaultState();
  const merged = { ...base, ...(raw || {}) };

  merged.xp = Math.max(0, Math.floor(Number(merged.xp) || 0));
  merged.totalWatched = Math.max(0, Math.floor(Number(merged.totalWatched) || 0));
  merged.listsCreated = Math.max(0, Math.floor(Number(merged.listsCreated) || 0));
  merged.listsCompleted = Math.max(0, Math.floor(Number(merged.listsCompleted) || 0));
  merged.currentStreak = Math.max(0, Math.floor(Number(merged.currentStreak) || 0));
  merged.bestStreak = Math.max(0, Math.floor(Number(merged.bestStreak) || 0));
  merged.lastWatchDate = merged.lastWatchDate ? String(merged.lastWatchDate) : null;

  merged.watchedMovieIds = uniqStrings(merged.watchedMovieIds, LIMITS.watchedMovieIds);
  merged.completedListNames = uniqStrings(merged.completedListNames, LIMITS.completedListNames);
  merged.rewardedCreatedListNames = uniqStrings(
    merged.rewardedCreatedListNames,
    LIMITS.rewardedCreatedListNames
  );
  merged.unlockedAchievements = uniqStrings(
    merged.unlockedAchievements.filter((id) => ACHIEVEMENT_BY_ID.has(id)),
    LIMITS.unlockedAchievements
  );

  merged.dailyWatchCounts = clampCounts(merged.dailyWatchCounts);
  merged.weeklyWatchCounts = clampCounts(merged.weeklyWatchCounts);

  merged.totalWatched = Math.max(merged.totalWatched, merged.watchedMovieIds.length);
  merged.listsCreated = Math.max(merged.listsCreated, merged.rewardedCreatedListNames.length);
  merged.listsCompleted = Math.max(merged.listsCompleted, merged.completedListNames.length);
  merged.bestStreak = Math.max(merged.bestStreak, merged.currentStreak);

  return merged;
}

function getTodayUTC() {
  return new Date().toISOString().split('T')[0];
}

function getWeekKeyUTC() {
  const d = new Date();
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekNum = Math.ceil(((today - startOfYear) / 86400000 + new Date(startOfYear).getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function updateStreak(state) {
  const today = getTodayUTC();
  if (state.lastWatchDate === today) return state;

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const newStreak = state.lastWatchDate === yesterdayStr ? state.currentStreak + 1 : 1;
  return {
    ...state,
    currentStreak: newStreak,
    bestStreak: Math.max(state.bestStreak, newStreak),
    lastWatchDate: today,
  };
}

function getLevelInfo(xp) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.xpNeeded) current = lvl;
    else break;
  }
  const next = LEVELS.find((l) => l.xpNeeded > xp) || null;
  const xpInLevel = xp - current.xpNeeded;
  const xpForNext = next ? next.xpNeeded - current.xpNeeded : 0;
  const progress = xpForNext > 0 ? xpInLevel / xpForNext : 1;
  return { current, next, xpInLevel, xpForNext, progress };
}

function evaluateAchievements(state) {
  const unlocked = new Set(state.unlockedAchievements || []);
  const newAchievements = [];

  for (const ach of ACHIEVEMENTS) {
    if (unlocked.has(ach.id)) continue;
    if (ach.condition(state)) {
      unlocked.add(ach.id);
      newAchievements.push({
        id: ach.id,
        title: ach.title,
        desc: ach.desc,
        icon: ach.icon,
      });
    }
  }

  state.unlockedAchievements = Array.from(unlocked);
  return newAchievements;
}

async function mutateGamification(uid, mutator) {
  const options = arguments[2] || {};
  const actionType = options.actionType || 'generic';
  const idempotencyKey = sanitizeIdempotencyKey(options.idempotencyKey);

  const ref = userDocRef(uid);
  let result = null;

  await getFirestore().runTransaction(async (tx) => {
    let eventRef = null;
    if (idempotencyKey) {
      eventRef = gamificationEventDocRef(uid, actionType, idempotencyKey);
      const existingEvent = await tx.get(eventRef);
      if (existingEvent.exists) {
        const replayResult = existingEvent.data()?.result || {};
        result = {
          ...replayResult,
          replayed: true,
        };
        return;
      }
    }

    const snap = await tx.get(ref);
    const existing = normalizeState(snap.exists ? snap.data().gamification : null);
    const prevLevel = getLevelInfo(existing.xp).current;

    const draft = normalizeState(existing);
    const mutation = await mutator(draft, { tx, uid });

    const finalState = normalizeState(mutation && mutation.state ? mutation.state : draft);
    const newLevel = getLevelInfo(finalState.xp).current;
    const leveledUp = newLevel.level > prevLevel.level ? newLevel : null;

    tx.set(
      ref,
      {
        gamification: {
          ...finalState,
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    result = {
      state: finalState,
      leveledUp,
      replayed: false,
      ...(mutation || {}),
    };
    delete result.state?.syncedAt;

    if (eventRef) {
      tx.set(eventRef, {
        actionType,
        idempotencyKey,
        result,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  return result;
}

async function recordWatch(uid, movieId, listName) {
  const options = arguments[3] || {};
  const normalizedMovieId = String(movieId || '').trim();
  const normalizedListName = String(listName || '').trim();
  if (!normalizedMovieId) {
    throw new AppError('movieId is required', 400, 'VALIDATION_ERROR');
  }
  if (!normalizedListName) {
    throw new AppError('listName is required', 400, 'VALIDATION_ERROR');
  }

  return mutateGamification(uid, async (state, ctx) => {
    const listSnap = await ctx.tx.get(watchlistDocRef(uid, normalizedListName));
    if (!listSnap.exists) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }

    const listData = listSnap.data() || {};
    const movies = Array.isArray(listData.movies) ? listData.movies : [];
    const matchingMovie = movies.find(
      (m) => String(m?.imdbID || '').trim() === normalizedMovieId
    );

    if (!matchingMovie || !matchingMovie.watched) {
      throw new AppError(
        'Movie must be marked watched in the specified list before awarding XP',
        409,
        'WATCH_NOT_ELIGIBLE'
      );
    }

    if (state.watchedMovieIds.includes(normalizedMovieId)) {
      return {
        state,
        xpGained: 0,
        canEarnXp: false,
        alreadyRewarded: true,
        newAchievements: [],
      };
    }

    state.watchedMovieIds = [...state.watchedMovieIds, normalizedMovieId];
    state.totalWatched += 1;

    const today = getTodayUTC();
    const weekKey = getWeekKeyUTC();
    state.dailyWatchCounts = {
      ...state.dailyWatchCounts,
      [today]: (state.dailyWatchCounts[today] || 0) + 1,
    };
    state.weeklyWatchCounts = {
      ...state.weeklyWatchCounts,
      [weekKey]: (state.weeklyWatchCounts[weekKey] || 0) + 1,
    };

    const streakState = updateStreak(state);
    Object.assign(state, streakState);

    const streakBonus = state.currentStreak > 1 ? (state.currentStreak - 1) * XP_STREAK_BONUS : 0;
    const xpGained = XP_PER_WATCH + streakBonus;
    state.xp += xpGained;

    const newAchievements = evaluateAchievements(state);

    return {
      state,
      xpGained,
      canEarnXp: true,
      alreadyRewarded: false,
      newAchievements,
    };
  }, { actionType: 'watch', idempotencyKey: options.idempotencyKey });
}

async function recordListCreated(uid, listName) {
  const options = arguments[2] || {};
  const normalized = normalizeKey(listName);
  const originalName = String(listName || '').trim();
  if (!normalized) {
    throw new AppError('listName is required', 400, 'VALIDATION_ERROR');
  }

  return mutateGamification(uid, async (state, ctx) => {
    const listSnap = await ctx.tx.get(watchlistDocRef(uid, originalName));
    if (!listSnap.exists) {
      throw new AppError('Watchlist not found', 404, 'NOT_FOUND');
    }

    if (state.rewardedCreatedListNames.includes(normalized)) {
      return {
        state,
        xpGained: 0,
        alreadyRewarded: true,
        newAchievements: [],
      };
    }

    if (state.rewardedCreatedListNames.length >= MAX_REWARDED_LIST_CREATES) {
      return {
        state,
        xpGained: 0,
        alreadyRewarded: true,
        rewardCapReached: true,
        newAchievements: [],
      };
    }

    state.rewardedCreatedListNames = [...state.rewardedCreatedListNames, normalized];
    state.listsCreated = Math.max(state.listsCreated, state.rewardedCreatedListNames.length);
    state.xp += XP_PER_LIST_CREATE;

    const newAchievements = evaluateAchievements(state);

    return {
      state,
      xpGained: XP_PER_LIST_CREATE,
      alreadyRewarded: false,
      newAchievements,
    };
  }, { actionType: 'list-created', idempotencyKey: options.idempotencyKey });
}

async function recordListCompleted(uid, listName) {
  const options = arguments[2] || {};
  const normalized = normalizeKey(listName);
  const originalName = String(listName || '').trim();
  if (!normalized) {
    throw new AppError('listName is required', 400, 'VALIDATION_ERROR');
  }

  return mutateGamification(uid, async (state, ctx) => {
    const listSnap = await ctx.tx.get(watchlistDocRef(uid, originalName));
    if (!listSnap.exists) {
      return {
        state,
        xpGained: 0,
        alreadyCompleted: true,
        newAchievements: [],
      };
    }

    const listData = listSnap.data() || {};
    const movies = Array.isArray(listData.movies) ? listData.movies : [];
    const allWatched = movies.length > 0 && movies.every((m) => !!m?.watched);

    if (!allWatched) {
      return {
        state,
        xpGained: 0,
        alreadyCompleted: true,
        newAchievements: [],
      };
    }

    if (state.completedListNames.includes(normalized)) {
      return {
        state,
        xpGained: 0,
        alreadyCompleted: true,
        newAchievements: [],
      };
    }

    state.completedListNames = [...state.completedListNames, normalized];
    state.listsCompleted = Math.max(state.listsCompleted, state.completedListNames.length);
    state.xp += XP_PER_LIST_COMPLETE;

    const newAchievements = evaluateAchievements(state);

    return {
      state,
      xpGained: XP_PER_LIST_COMPLETE,
      alreadyCompleted: false,
      newAchievements,
    };
  }, { actionType: 'list-completed', idempotencyKey: options.idempotencyKey });
}

function movieIdFromWatchlistItem(movie) {
  const imdbID = String(movie?.imdbID || '').trim();
  if (imdbID) return imdbID;

  const tmdbId = movie?.tmdb_id;
  const mediaType = movie?.media_type || movie?.Type || 'movie';
  if (tmdbId) {
    return `tmdb:${String(mediaType).toLowerCase()}:${String(tmdbId)}`;
  }

  const idKey = String(movie?.id?.key || '').trim();
  if (idKey) return idKey;

  return null;
}

function createdAtMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
  }
  return 0;
}

function recomputeStateFromWatchlists(watchlists) {
  const state = defaultState();
  const watchedIds = new Set();
  const completedNames = new Set();

  const lists = Array.isArray(watchlists) ? watchlists : [];
  const createdListNames = lists
    .map((list) => ({
      name: normalizeKey(list?.name || list?.id),
      createdAtMs: createdAtMillis(list?.createdAt),
    }))
    .filter((x) => !!x.name)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const rewardedCreatedListNames = [];
  for (const entry of createdListNames) {
    if (!rewardedCreatedListNames.includes(entry.name)) {
      rewardedCreatedListNames.push(entry.name);
    }
    if (rewardedCreatedListNames.length >= MAX_REWARDED_LIST_CREATES) break;
  }

  for (const list of lists) {
    const normalizedName = normalizeKey(list?.name || list?.id);
    const movies = Array.isArray(list?.movies) ? list.movies : [];
    const nonEmpty = movies.length > 0;
    const allWatched = nonEmpty && movies.every((m) => !!m?.watched);

    if (normalizedName && allWatched) {
      completedNames.add(normalizedName);
    }

    for (const movie of movies) {
      if (!movie?.watched) continue;
      const id = movieIdFromWatchlistItem(movie);
      if (id) watchedIds.add(id);
    }
  }

  state.watchedMovieIds = Array.from(watchedIds);
  state.completedListNames = Array.from(completedNames);
  state.rewardedCreatedListNames = rewardedCreatedListNames;

  state.totalWatched = state.watchedMovieIds.length;
  state.listsCreated = state.rewardedCreatedListNames.length;
  state.listsCompleted = state.completedListNames.length;
  state.currentStreak = 0;
  state.bestStreak = 0;
  state.lastWatchDate = null;
  state.dailyWatchCounts = {};
  state.weeklyWatchCounts = {};

  state.xp =
    state.totalWatched * XP_PER_WATCH +
    state.listsCreated * XP_PER_LIST_CREATE +
    state.listsCompleted * XP_PER_LIST_COMPLETE;

  evaluateAchievements(state);
  return normalizeState(state);
}

async function recomputeGamificationForUser(uid) {
  const options = arguments[1] || {};
  const dryRun = !!options.dryRun;

  const watchlistsSnap = await userDocRef(uid).collection('watchlists').limit(500).get();
  const watchlists = watchlistsSnap.docs.map((d) => ({
    id: d.id,
    name: d.id,
    ...d.data(),
  }));

  const recomputed = recomputeStateFromWatchlists(watchlists);
  if (!dryRun) {
    await userDocRef(uid).set(
      {
        gamification: {
          ...recomputed,
          migrationVersion: 'gamification-recompute-v1',
          migrationSource: 'watchlists',
          migrationConfidence: 'medium',
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    uid,
    dryRun,
    state: recomputed,
    stats: {
      watchlists: watchlists.length,
      watchedMovieIds: recomputed.watchedMovieIds.length,
      completedListNames: recomputed.completedListNames.length,
    },
  };
}

module.exports = {
  ACHIEVEMENTS,
  defaultState,
  getLevelInfo,
  recordWatch,
  recordListCreated,
  recordListCompleted,
  recomputeStateFromWatchlists,
  recomputeGamificationForUser,
  sanitizeIdempotencyKey,
};
