'use strict';

const axios = require('axios');
const { LIMITS } = require('./sources');

/** Conditional GET of one feed. Resolves {status:200|304, body, etag, lastModified}; rejects with a short message. */
async function fetchFeed(source, prev = {}) {
  const headers = {
    'User-Agent': 'CineLinkNewsBot/1.0 (headlines and links only; contact via the app store listing)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  };
  if (prev.etag) headers['If-None-Match'] = prev.etag;
  if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
  try {
    const res = await axios.get(source.url, {
      headers,
      timeout: LIMITS.timeoutMs,
      maxContentLength: LIMITS.maxBytes,
      maxRedirects: 3,
      responseType: 'text',
      transformResponse: (x) => x,
      validateStatus: (s) => s === 200 || s === 304,
    });
    return {
      status: res.status,
      body: res.status === 200 ? res.data : '',
      etag: res.headers?.etag || null,
      lastModified: res.headers?.['last-modified'] || null,
    };
  } catch (err) {
    // Keep it short and free of URLs/headers.
    const msg = err.response ? `HTTP ${err.response.status}` : err.code || 'request failed';
    throw new Error(msg);
  }
}

module.exports = { fetchFeed };
