/*
  Check every configured news feed from THIS machine. Needs no Firebase and writes nothing.

    node scripts/check-news-sources.js
*/
const { SOURCES, LIMITS } = require('../src/services/news/sources');
const { fetchFeed } = require('../src/services/news/fetchFeed');
const { parseFeed } = require('../src/services/news/parse');

(async () => {
  let bad = 0;
  for (const s of SOURCES) {
    try {
      const res = await fetchFeed(s);
      const items = parseFeed(res.body, s, { maxAgeDays: 3650, limit: 100 });
      const img = items.filter((i) => i.image).length;
      const newest = items[0] ? new Date(items[0].publishedAt).toISOString().slice(0, 16) : 'n/a';
      const flag = items.length === 0 ? 'EMPTY' : img < items.length / 2 ? 'FEW IMAGES' : 'ok';
      if (flag !== 'ok') bad += 1;
      console.log(`${flag.padEnd(10)} ${s.id.padEnd(18)} items ${String(items.length).padStart(3)}  images ${String(img).padStart(3)}  newest ${newest}`);
      if (items[0]) console.log(`           e.g. [${items[0].category}] ${items[0].title}`);
    } catch (err) {
      bad += 1;
      console.log(`FAILED     ${s.id.padEnd(18)} ${err.message}`);
    }
  }
  console.log(`\n${SOURCES.length - bad} of ${SOURCES.length} look good. Remove or fix the rest in src/services/news/sources.js.`);
  void LIMITS;
})();
