/*
  Find episodes the sync missed by searching YouTube for each episode number.
  Costs 100 quota units per episode searched, so it is capped per run.

    node scripts/fill-streaming-gaps.js 8630 --list                  # print missing numbers, no quota used
    node scripts/fill-streaming-gaps.js 8630 --limit 20 --dry-run    # search 20, show what it would add and why others fail
    node scripts/fill-streaming-gaps.js 8630 --limit 30              # search 30 and save what is found
    options: --from N (start at episode N)  --upto N (default: latest episode in the catalog)

  The YouTube key is only read from the environment and is never printed.
*/

const { initializeFirebase, getFirestore } = require('../src/config/firebase');
const { env } = require('../src/config/environment');
const { createCatalog } = require('../src/services/streaming/catalog');
const { createYouTube } = require('../src/services/streaming/youtube');
const { fillGaps, missingNumbers, mergeSources } = require('../src/services/streaming/gaps');
const { getShow } = require('../src/services/streaming/shows');

const opt = (args, name, d) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : d;
};

async function main() {
  const args = process.argv.slice(2);
  const show = getShow(args.find((a) => !a.startsWith('--')));
  if (!show) throw new Error('Pass a configured TMDB id, e.g. 8630.');
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  if (!listOnly && !env.YOUTUBE_API_KEY) throw new Error('Set YOUTUBE_API_KEY in your environment first.');

  await initializeFirebase();
  const catalog = createCatalog(getFirestore());
  const have = await catalog.loadEpisodes(show.tmdbId);
  const latest = Math.max(0, ...have.keys());
  const upTo = opt(args, '--upto', latest);
  const from = opt(args, '--from', 1);
  const missing = missingNumbers(have, upTo).filter((n) => n >= from);

  if (listOnly) {
    console.log(JSON.stringify({ upTo, missingCount: missing.length, missing }));
    return;
  }

  const limit = opt(args, '--limit', 30);
  const res = await fillGaps({
    show,
    youtube: createYouTube({ apiKey: env.YOUTUBE_API_KEY }),
    missing,
    limit,
  });
  if (!dryRun && res.added.size) {
    const after = new Map([...have].map(([n, l]) => [n, l.map((s) => ({ ...s }))]));
    for (const [n, list] of res.added) after.set(n, mergeSources(after.get(n) || [], list));
    await catalog.saveEpisodes(show.tmdbId, after, have);
  }
  console.log(
    JSON.stringify(
      {
        dryRun,
        missingBefore: missing.length,
        searched: res.tried.length,
        found: [...res.added.keys()],
        notFound: res.why,
        stoppedEarly: res.stoppedEarly,
        quotaUnits: res.quotaUnits,
      },
      null,
      2
    )
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
