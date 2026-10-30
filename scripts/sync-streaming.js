/*
  Update the free-episode catalog from YouTube.

  Usage (same env as the server, plus YOUTUBE_API_KEY, e.g. your .env):
    node scripts/sync-streaming.js 8630 --mode full      # first time: every upload (about 2,200 quota units)
    node scripts/sync-streaming.js 8630 --mode recent    # daily: newest uploads (about 8 units)
    node scripts/sync-streaming.js 8630 --mode verify    # weekly: drop videos that went away (about 50 units)
    node scripts/sync-streaming.js 8630 --mode full --dry-run   # fetch and report, write nothing

  The YouTube key is only read from the environment and is never printed.
*/

const { initializeFirebase, getFirestore } = require('../src/config/firebase');
const { env } = require('../src/config/environment');
const { createCatalog } = require('../src/services/streaming/catalog');
const { createYouTube } = require('../src/services/streaming/youtube');
const { syncShow } = require('../src/services/streaming/sync');
const { getShow } = require('../src/services/streaming/shows');

async function main() {
  const args = process.argv.slice(2);
  const tmdbId = args.find((a) => !a.startsWith('--'));
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'recent';
  const dryRun = args.includes('--dry-run');

  const show = getShow(tmdbId);
  if (!show) throw new Error('Pass a configured TMDB id, e.g. 8630. See src/services/streaming/shows.js');
  if (!env.YOUTUBE_API_KEY) throw new Error('Set YOUTUBE_API_KEY in your environment first.');

  await initializeFirebase();
  const real = createCatalog(getFirestore());
  const catalog = dryRun ? { ...real, saveEpisodes: async () => 0, saveMeta: async () => {} } : real;
  const report = await syncShow({ show, mode, youtube: createYouTube({ apiKey: env.YOUTUBE_API_KEY }), catalog });
  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
