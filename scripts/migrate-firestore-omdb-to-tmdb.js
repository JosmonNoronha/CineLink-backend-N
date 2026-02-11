/*
One-time migration helper.

What it does (high level):
- Scans users/{uid} docs
- Reads legacy OMDb-shaped favorites stored in users/{uid}.userFavorites (array)
- Resolves imdbID -> TMDB id via /find/{imdb}
- Writes new favorites to users/{uid}/favorites/{tmdb_id}

This script is intentionally conservative and supports --dry-run.

Usage:
  node scripts/migrate-firestore-omdb-to-tmdb.js --dry-run
  node scripts/migrate-firestore-omdb-to-tmdb.js --limit=50
*/

const { getFirestore } = require('../src/config/firebase');
const { resolveByImdbId } = require('../src/services/tmdb/find');
const { logger } = require('../src/utils/logger');

function getArg(name) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return null;
  const arg = process.argv[idx];
  if (arg.includes('=')) return arg.split('=')[1];
  return process.argv[idx + 1] || 'true';
}

async function main() {
  const dryRun = getArg('dry-run') !== null;
  const limitRaw = getArg('limit');
  const limit = limitRaw ? Number(limitRaw) : 0;

  const db = getFirestore();
  const usersSnap = await db.collection('users').get();
  let processed = 0;

  for (const userDoc of usersSnap.docs) {
    if (limit && processed >= limit) break;
    processed++;

    const uid = userDoc.id;
    const data = userDoc.data() || {};
    const favorites = Array.isArray(data.userFavorites) ? data.userFavorites : [];

    logger.info('Migrating user', { uid, favoritesCount: favorites.length, dryRun });

    for (const fav of favorites) {
      const imdbID = fav?.imdbID;
      if (!imdbID || typeof imdbID !== 'string') continue;

      try {
        const found = await resolveByImdbId(imdbID);
        const movie = (found.movie_results || [])[0];
        const tv = (found.tv_results || [])[0];
        const media_type = movie?.id ? 'movie' : tv?.id ? 'tv' : null;
        const tmdb_id = movie?.id || tv?.id;
        if (!media_type || !tmdb_id) {
          logger.warn('Could not resolve imdbID', { uid, imdbID });
          continue;
        }

        const ref = db.collection('users').doc(uid).collection('favorites').doc(String(tmdb_id));
        const payload = {
          tmdb_id,
          media_type,
          imdb_id: imdbID,
          title: fav.Title || null,
          poster: fav.Poster || null,
          metadata: fav,
        };

        if (!dryRun) {
          await ref.set(payload, { merge: true });
        }
      } catch (e) {
        logger.warn('Migration error', { uid, imdbID, error: e.message });
      }
    }
  }

  logger.info('Migration complete', { processedUsers: processed, dryRun });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
