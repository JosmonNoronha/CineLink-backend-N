/*
  One-time backfill: set `previewPosters` (newest 4 item posters) on existing public watchlists.

  Usage (from the backend folder, with the same env/.env the server uses):
    node scripts/backfill-preview-posters.js            # dry run, writes nothing
    node scripts/backfill-preview-posters.js --live     # actually writes
*/

const { initializeFirebase, getFirestore } = require('../src/config/firebase');
const { logger } = require('../src/utils/logger');

const live = process.argv.includes('--live');

async function main() {
  await initializeFirebase();
  const db = getFirestore();

  const lists = await db.collection('publicWatchlists').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of lists.docs) {
    const recent = await doc.ref.collection('items').orderBy('addedAt', 'desc').limit(4).get();
    const posters = recent.docs.map((d) => d.data().poster).filter(Boolean);

    const current = doc.data().previewPosters;
    if (Array.isArray(current) && JSON.stringify(current) === JSON.stringify(posters)) {
      skipped += 1;
      continue;
    }

    logger.info(`${live ? 'Updating' : '[dry-run] would update'} ${doc.id} -> ${posters.length} posters`);
    if (live) await doc.ref.update({ previewPosters: posters });
    updated += 1;
  }

  logger.info(`Done. ${live ? 'updated' : 'would update'}: ${updated}, already correct: ${skipped}, total: ${lists.size}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(`Backfill failed: ${err.message}`);
    process.exit(1);
  });