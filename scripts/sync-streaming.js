/*
  Update the free-episode catalog from YouTube.

  Usage (same env as the server, plus YOUTUBE_API_KEY, e.g. your .env):
    node scripts/sync-streaming.js 8630 --mode full      # first time: every upload (about 2,200 quota units)
    node scripts/sync-streaming.js 8630 --mode recent    # daily: newest uploads (about 8 units)
    node scripts/sync-streaming.js 8630 --mode verify    # weekly: drop videos that went away (about 50 units)
    node scripts/sync-streaming.js 8630 --mode full --dry-run   # fetch and report, write nothing
    node scripts/sync-streaming.js all --mode recent     # every configured show, one after another (the daily job)

  Shows with `nameMatch: true` (titles without an episode number) also need TMDB_API_KEY to read the episode names.
  The YouTube and TMDB keys are only read from the environment and are never printed.
*/

const { initializeFirebase, getFirestore } = require('../src/config/firebase');
const { env } = require('../src/config/environment');
const { createCatalog } = require('../src/services/streaming/catalog');
const { createYouTube } = require('../src/services/streaming/youtube');
const { syncShow } = require('../src/services/streaming/sync');
const { createEpisodeNames } = require('../src/services/streaming/tmdbNames');
const { getShow, listShows } = require('../src/services/streaming/shows');

async function main() {
  const args = process.argv.slice(2);
  const tmdbId = args.find((a) => !a.startsWith('--'));
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'recent';
  const dryRun = args.includes('--dry-run');

  const shows = tmdbId === 'all' ? listShows() : [getShow(tmdbId)].filter(Boolean);
  if (!shows.length)
    throw new Error('Pass a configured TMDB id (e.g. 8630) or "all". See src/services/streaming/shows.js');
  if (!env.YOUTUBE_API_KEY) throw new Error('Set YOUTUBE_API_KEY in your environment first.');

  await initializeFirebase();
  const real = createCatalog(getFirestore());
  const catalog = dryRun ? { ...real, saveEpisodes: async () => 0, saveMeta: async () => {} } : real;
  const youtube = createYouTube({ apiKey: env.YOUTUBE_API_KEY });
  const tmdbKey = env.TMDB_API_KEY || process.env.TMDB_API_KEY;
  const episodeNames = tmdbKey ? createEpisodeNames({ apiKey: tmdbKey }) : undefined;
  let failed = 0;
  for (const show of shows) {
    try {
      const report = await syncShow({ show, mode, youtube, catalog, episodeNames });
      console.log(JSON.stringify({ dryRun, ...report }, null, 2));
    } catch (err) {
      // One show failing must not stop the others; the exit code still reports it.
      failed += 1;
      console.error(`Show ${show.tmdbId} failed: ${err.message}`);
    }
  }
  if (failed) throw new Error(`${failed} of ${shows.length} shows failed`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
