/*
  Refresh the news feed from the curated RSS sources (src/services/news/sources.js).

    node scripts/sync-news.js              # fetch, merge, save
    node scripts/sync-news.js --dry-run    # fetch and report, write nothing
*/
const { initializeFirebase, getFirestore } = require('../src/config/firebase');
const { createNewsStore } = require('../src/services/news/store');
const { fetchFeed } = require('../src/services/news/fetchFeed');
const { syncNews } = require('../src/services/news/sync');
const { SOURCES } = require('../src/services/news/sources');
const { createTrendTerms } = require('../src/services/news/trending');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await initializeFirebase();
  const report = await syncNews({
    sources: SOURCES.filter((s) => s.enabled !== false),
    store: createNewsStore(getFirestore()),
    fetchFeed,
    getTrendTerms: process.env.TMDB_API_KEY ? () => createTrendTerms({ apiKey: process.env.TMDB_API_KEY }).load() : undefined,
    dryRun,
  });
  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
  // Individual feeds failing is normal; only "nothing worked" fails the job.
  if (report.saved === false && !dryRun) throw new Error('Every source failed; the stored feed was left unchanged');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
