'use strict';

/**
 * Curated news feeds. Each is a publisher's own public RSS feed; we show headline, a short excerpt,
 * a thumbnail and a link out with the source name, never the full article.
 *
 * `region`: 'global' | 'in'.  `priority`: lower wins when two sources carry the same story.
 * Run `node scripts/check-news-sources.js` to see which URLs answer, then delete or fix the ones that don't.
 * Check each publisher's terms before shipping; disable any source with `enabled: false` (or from the admin API).
 */
const SOURCES = [
  { id: 'variety', name: 'Variety', url: 'https://variety.com/feed/', region: 'global', priority: 1 },
  { id: 'deadline', name: 'Deadline', url: 'https://deadline.com/feed/', region: 'global', priority: 1 },
  { id: 'thr', name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', region: 'global', priority: 1 },
  { id: 'indiewire', name: 'IndieWire', url: 'https://www.indiewire.com/feed/', region: 'global', priority: 2 },
  { id: 'collider', name: 'Collider', url: 'https://collider.com/feed/', region: 'global', priority: 3 },
  { id: 'screenrant', name: 'Screen Rant', url: 'https://screenrant.com/feed/', region: 'global', priority: 3 },
  {
    id: 'hindu-cinema',
    name: 'The Hindu',
    url: 'https://www.thehindu.com/entertainment/movies/feeder/default.rss',
    region: 'in',
    priority: 1,
  },
  {
    id: 'indianexpress-ent',
    name: 'The Indian Express',
    url: 'https://indianexpress.com/section/entertainment/feed/',
    region: 'in',
    priority: 2,
  },
  {
    id: 'ht-ent',
    name: 'Hindustan Times',
    url: 'https://www.hindustantimes.com/feeds/rss/entertainment/rssfeed.xml',
    region: 'in',
    priority: 2,
  },
  {
    id: 'toi-ent',
    name: 'Times of India',
    url: 'https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms',
    region: 'in',
    priority: 2,
  },
  {
    id: 'bollywoodhungama',
    name: 'Bollywood Hungama',
    url: 'https://www.bollywoodhungama.com/rss/news.xml',
    region: 'in',
    priority: 3,
  },
];

const LIMITS = {
  maxStored: 400, // items kept in the feed document
  maxPerSource: 60, // so one chatty source cannot crowd out the rest
  maxPerFeedRead: 40, // newest items taken from each fetch
  maxAgeDays: 21,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10000,
};

const enabledSources = () => SOURCES.filter((s) => s.enabled !== false);
const getSource = (id) => SOURCES.find((s) => s.id === id);

module.exports = { SOURCES, LIMITS, enabledSources, getSource };
