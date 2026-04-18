/*
  Recompute gamification state from watchlists for all users or a single user.

  Usage:
    node scripts/recompute-gamification.js --dry-run
    node scripts/recompute-gamification.js --live
    node scripts/recompute-gamification.js --live --uid <firebase_uid>
    node scripts/recompute-gamification.js --dry-run --limit 100
*/

const { initializeFirebase, getFirestore } = require('../src/config/firebase');
const { logger } = require('../src/utils/logger');
const gamificationService = require('../src/services/user/gamification');

function parseArgs(argv) {
  const args = {
    dryRun: true,
    uid: null,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--live') args.dryRun = false;
    if (token === '--dry-run') args.dryRun = true;
    if (token === '--uid') args.uid = argv[i + 1] || null;
    if (token === '--limit') {
      const n = Number(argv[i + 1]);
      args.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }

  return args;
}

async function collectUserIds({ uid, limit }) {
  if (uid) return [uid];

  const out = [];
  const usersRef = getFirestore().collection('users');
  let cursor = null;
  const pageSize = 300;

  while (true) {
    let query = usersRef.orderBy('__name__').limit(pageSize);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      out.push(doc.id);
      if (limit && out.length >= limit) return out;
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initializeFirebase();

  const userIds = await collectUserIds({ uid: args.uid, limit: args.limit });
  if (!userIds.length) {
    // eslint-disable-next-line no-console
    console.log('No users found to process.');
    return;
  }

  let processed = 0;
  let failed = 0;
  let totalXp = 0;

  // eslint-disable-next-line no-console
  console.log(
    `[recompute-gamification] mode=${args.dryRun ? 'dry-run' : 'live'} users=${userIds.length}`
  );

  for (const uid of userIds) {
    try {
      const result = await gamificationService.recomputeGamificationForUser(uid, {
        dryRun: args.dryRun,
      });

      processed += 1;
      totalXp += result.state?.xp || 0;

      // eslint-disable-next-line no-console
      console.log(
        `${args.dryRun ? '[DRY]' : '[LIVE]'} uid=${uid} xp=${result.state?.xp || 0} watched=${
          result.stats?.watchedMovieIds || 0
        } listsCreated=${result.state?.listsCreated || 0} listsCompleted=${
          result.state?.listsCompleted || 0
        }`
      );
    } catch (error) {
      failed += 1;
      logger.error('recompute-gamification failed', {
        uid,
        message: error?.message || String(error),
      });
      // eslint-disable-next-line no-console
      console.error(`FAILED uid=${uid} reason=${error?.message || String(error)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[recompute-gamification] complete mode=${args.dryRun ? 'dry-run' : 'live'} processed=${processed} failed=${failed} totalXp=${totalXp}`
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  logger.error('recompute-gamification fatal', {
    message: error?.message || String(error),
    stack: error?.stack,
  });
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
