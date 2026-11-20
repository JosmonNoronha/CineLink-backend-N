'use strict';

const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  trimValues: true,
});

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** XML node -> string (handles attributes, CDATA text nodes and arrays). */
function text(node) {
  if (node == null) return '';
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') return text(node['#text']);
  return String(node);
}

/** HTML -> plain text. Drops scripts/styles, tags and entities, collapses whitespace. */
function stripHtml(html) {
  const noTags = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|br|div|li|ul|ol|h[1-6]|tr|td|blockquote|figure|figcaption)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** Only https URLs are ever stored (http is upgraded). Anything else returns null. */
function safeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

const TRACKING = /^(utm_|fbclid|gclid|igshid|mc_|ref$|source$|cmpid|ocid)/i;
function canonicalUrl(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

const idOf = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function pickLink(item) {
  const l = item.link;
  if (typeof l === 'string') return l;
  const arr = Array.isArray(l) ? l : l ? [l] : [];
  const alt = arr.find((x) => typeof x === 'object' && (!x['@_rel'] || x['@_rel'] === 'alternate')) || arr[0];
  if (typeof alt === 'string') return alt;
  return alt?.['@_href'] || text(item.guid);
}

function firstImgSrc(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  return m ? decodeEntities(m[1]) : null;
}

function pickImage(item, html) {
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const cands = [];
  for (const t of list(item['media:thumbnail'])) cands.push(t?.['@_url']);
  for (const c of list(item['media:content'])) {
    const medium = c?.['@_medium'];
    const type = c?.['@_type'] || '';
    if (medium === 'image' || type.startsWith('image/') || (!medium && !type)) cands.push(c?.['@_url']);
    for (const t of list(c?.['media:thumbnail'])) cands.push(t?.['@_url']);
  }
  for (const g of list(item['media:group'])) {
    for (const t of list(g?.['media:thumbnail'])) cands.push(t?.['@_url']);
  }
  for (const e of list(item.enclosure)) if ((e?.['@_type'] || '').startsWith('image/')) cands.push(e['@_url']);
  cands.push(firstImgSrc(html));
  for (const c of cands) {
    const u = safeUrl(c);
    if (u && u.toString().length <= 600) return u.toString();
  }
  return null;
}

const CATEGORY_RULES = [
  ['trailers', /\b(trailer|teaser|first look|sneak peek|official clip)\b/i],
  ['boxoffice', /\b(box[- ]office|opening weekend|crore|grosses|gross(es)?\b.*\b(million|billion))/i],
  ['awards', /\b(oscars?|emmys?|golden globes?|bafta|cannes|filmfare|national film awards?|nominat|awards?)\b/i],
  ['reviews', /\b(review|ratings? explained)\b/i],
  ['casting', /\b(cast(s|ed|ing)?|joins|set to star|to play|replaces|returns? for)\b/i],
  ['streaming', /\b(netflix|prime video|amazon prime|disney\+|hotstar|jiocinema|jio ?hotstar|zee5|sonyliv|apple tv\+?|hbo max|max original|ott|streaming|renewed|canceled|cancelled)\b/i],
  ['interviews', /\b(interview|exclusive|opens up|speaks about|talks about)\b/i],
];
const TV = /\b(season|series|episode|showrunner|sitcom|tv show|web series|reality show)\b/i;

function categorise(title, summary) {
  const hay = `${title} ${summary}`.slice(0, 600);
  for (const [name, re] of CATEGORY_RULES) if (re.test(title) || (name !== 'reviews' && re.test(hay))) return name;
  return TV.test(hay) ? 'tv' : 'news';
}
const CATEGORIES = ['news', 'tv', ...CATEGORY_RULES.map((r) => r[0])];

function parseDate(raw) {
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : null;
}

/**
 * Parse an RSS 2.0 or Atom document into normalised items. Never throws on a bad item;
 * throws only when the document is not a feed at all.
 */
function parseFeed(xml, source, { now = Date.now(), maxAgeDays = 21, limit = 40 } = {}) {
  let doc;
  try {
    doc = parser.parse(String(xml || ''));
  } catch (err) {
    throw new Error('Not valid XML');
  }
  const raw = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.['rdf:RDF']?.item;
  if (raw === undefined) throw new Error('No items in feed');
  const entries = Array.isArray(raw) ? raw : [raw];

  const out = [];
  const oldest = now - maxAgeDays * 86400000;
  for (const e of entries) {
    try {
      const url = canonicalUrl(pickLink(e));
      const title = truncate(stripHtml(text(e.title)), 160);
      if (!url || !title) continue;
      const html = text(e['content:encoded']) || text(e.content) || text(e.description) || text(e.summary);
      const excerpt = truncate(stripHtml(text(e.description) || text(e.summary) || html), 220);
      let at = parseDate(text(e.pubDate) || text(e.published) || text(e.updated) || text(e['dc:date']));
      if (at === null || at < oldest) continue;
      if (at > now + 3600000) at = now; // clock skew or scheduled posts
      out.push({
        id: idOf(url),
        title,
        excerpt: excerpt === title ? '' : excerpt,
        url,
        image: pickImage(e, html),
        source: source.id,
        sourceName: source.name,
        region: source.region,
        category: categorise(title, excerpt),
        publishedAt: at,
      });
    } catch {
      /* skip one bad item */
    }
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return out.slice(0, limit);
}

module.exports = { parseFeed, stripHtml, truncate, canonicalUrl, safeUrl, titleKey, categorise, CATEGORIES, idOf };
