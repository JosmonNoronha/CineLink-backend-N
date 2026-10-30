'use strict';

const axios = require('axios');
const { AppError } = require('../../utils/errors');
const { parseDuration, compactRegion } = require('./matcher');

const BASE = 'https://www.googleapis.com/youtube/v3';
const BATCH = 50;

/** Uploads playlist of a channel id: "UCxxxx" -> "UUxxxx" (no API call needed). */
const uploadsPlaylistId = (channelId) => `UU${String(channelId).slice(2)}`;

/**
 * Minimal YouTube Data API client. The API key travels as a query parameter, so every error is
 * rewritten here and the key can never reach a log or an HTTP response.
 */
function createYouTube({ apiKey, http = axios, baseUrl = BASE } = {}) {
  const usage = { units: 0 };

  async function call(path, params, cost = 1) {
    if (!apiKey) throw new AppError('YouTube API key is not configured', 503, 'YOUTUBE_NOT_CONFIGURED');
    try {
      const res = await http.get(`${baseUrl}/${path}`, {
        params: { ...params, key: apiKey },
        timeout: 15000,
      });
      usage.units += cost;
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      const reason =
        err?.response?.data?.error?.errors?.[0]?.reason || err?.response?.data?.error?.status || '';
      if (status === 403 && /quota/i.test(reason))
        throw new AppError('YouTube daily quota used up', 503, 'YOUTUBE_QUOTA', undefined, {
          retryable: true,
        });
      throw new AppError(
        `YouTube ${path} failed (${status || 'network'}${reason ? `: ${reason}` : ''})`,
        502,
        'YOUTUBE_FAILED',
        undefined,
        { retryable: true }
      );
    }
  }

  /** Newest-first uploads: [{ videoId, title, publishedAt }]. */
  async function listUploads(playlistId, { max = 50 } = {}) {
    const out = [];
    let pageToken;
    do {
      const data = await call('playlistItems', {
        part: 'snippet',
        playlistId,
        maxResults: Math.min(BATCH, max - out.length || BATCH),
        pageToken,
      });
      for (const it of data.items || []) {
        const videoId = it.snippet?.resourceId?.videoId;
        if (videoId)
          out.push({ videoId, title: it.snippet.title || '', publishedAt: it.snippet.publishedAt || null });
      }
      pageToken = data.nextPageToken;
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  }

  /** videoId -> { channelId, seconds, embeddable, privacy, ageRestricted, region }. Missing ids are absent. */
  async function videoDetails(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += BATCH) {
      const data = await call('videos', {
        part: 'contentDetails,status,snippet',
        id: ids.slice(i, i + BATCH).join(','),
        maxResults: BATCH,
      });
      for (const v of data.items || []) {
        out.set(v.id, {
          channelId: v.snippet?.channelId || null,
          seconds: parseDuration(v.contentDetails?.duration),
          embeddable: v.status?.embeddable !== false,
          privacy: v.status?.privacyStatus || 'public',
          ageRestricted: v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
          region: compactRegion(v.contentDetails?.regionRestriction),
        });
      }
    }
    return out;
  }

  /** Keyword search (costs 100 quota units): [{ videoId, title, channelId, publishedAt }]. */
  async function searchVideos(q, { max = 25 } = {}) {
    const data = await call(
      'search',
      { part: 'snippet', type: 'video', q, maxResults: Math.min(50, max) },
      100
    );
    return (data.items || [])
      .filter((it) => it.id?.videoId)
      .map((it) => ({
        videoId: it.id.videoId,
        title: it.snippet?.title || '',
        channelId: it.snippet?.channelId || null,
        publishedAt: it.snippet?.publishedAt || null,
      }));
  }

  return { listUploads, videoDetails, searchVideos, usage };
}

module.exports = { createYouTube, uploadsPlaylistId };
