'use strict';

const { toSource, mergeSources, titleLooksLikeEpisode } = require('./matcher');
const { uploadsPlaylistId } = require('./youtube');
const { logger } = require('../../utils/logger');

const MODES = {
  full: { max: 30000 }, // every upload: run from your own computer (about 2,200 quota units)
  recent: { max: 60 }, // newest uploads: the daily job (about 8 quota units)
  verify: {}, // re-check stored videos are still public, embeddable and in the same regions
};

const cloneMap = (m) => new Map([...m].map(([n, list]) => [n, list.map((s) => ({ ...s }))]));

/** Collect sources for one channel from its uploads. */
async function collectChannel(youtube, show, channel, max) {
  const uploads = (await youtube.listUploads(uploadsPlaylistId(channel.id), { max })).filter((u) =>
    show.match.test(u.title)
  );
  const details = await youtube.videoDetails(uploads.map((u) => u.videoId));
  const found = new Map();
  for (const u of uploads) {
    const d = details.get(u.videoId);
    if (!d) continue;
    const hit = toSource({ ...u, ...d }, show, channel);
    if (hit) found.set(hit.n, [...(found.get(hit.n) || []), hit.src]);
  }
  return { found, seen: uploads.length, ids: uploads.map((u) => u.videoId) };
}

/**
 * Older episodes live outside the capped uploads list, in the channel's playlists. A playlist can
 * hold other people's videos, so a video counts only when one of the show's own channels uploaded it.
 */
async function collectPlaylists(youtube, show, channel, skip) {
  const ownById = new Map(show.channels.map((c) => [c.id, c]));
  const found = new Map();
  let seen = 0;
  const tried = new Set(skip);
  for (const playlistId of channel.playlists || []) {
    const items = (await youtube.listUploads(playlistId, { max: 6000 })).filter(
      (u) => !tried.has(u.videoId) && titleLooksLikeEpisode(u.title, show)
    );
    items.forEach((u) => tried.add(u.videoId));
    seen += items.length;
    const details = await youtube.videoDetails(items.map((u) => u.videoId));
    for (const u of items) {
      const d = details.get(u.videoId);
      const owner = d && ownById.get(d.channelId);
      if (!owner) continue;
      const hit = toSource({ ...u, ...d }, show, owner);
      if (hit) found.set(hit.n, [...(found.get(hit.n) || []), hit.src]);
    }
  }
  return { found, seen, tried };
}

/** Drop stored sources whose video is gone, private, no longer embeddable, or whose regions changed. */
async function verifyStored(youtube, current) {
  const ids = [...new Set([...current.values()].flat().map((s) => s.v))];
  const details = await youtube.videoDetails(ids);
  const next = new Map();
  let removed = 0;
  let updated = 0;
  for (const [n, list] of current) {
    const kept = [];
    for (const s of list) {
      const d = details.get(s.v);
      if (!d || d.embeddable === false || d.privacy !== 'public' || d.ageRestricted) {
        removed += 1;
        continue;
      }
      const region = d.region || null;
      if (JSON.stringify(region) !== JSON.stringify(s.r || null)) {
        updated += 1;
        kept.push({ ...s, r: region });
      } else kept.push(s);
    }
    if (kept.length) next.set(n, kept);
  }
  return { next, removed, updated, checked: ids.length };
}

/**
 * Update one show's catalog.
 *  full   - rebuild from every upload of every channel
 *  recent - merge the newest uploads into what is stored
 *  verify - drop videos that went away
 */
async function syncShow({ show, mode = 'recent', youtube, catalog }) {
  if (!MODES[mode]) throw new Error(`Unknown sync mode: ${mode}`);
  const before = await catalog.loadEpisodes(show.tmdbId);
  let after = cloneMap(before);
  const report = { mode, show: show.tmdbId, channels: {}, removedVideos: 0 };
  const startUnits = youtube.usage.units;

  if (mode === 'verify') {
    const v = await verifyStored(youtube, after);
    after = v.next;
    report.removedVideos = v.removed;
    report.regionUpdates = v.updated;
    report.checkedVideos = v.checked;
  } else {
    const rebuilt = new Map();
    const done = new Set();
    const known = new Set();
    for (const channel of show.channels) {
      try {
        const { found, seen, ids } = await collectChannel(youtube, show, channel, MODES[mode].max);
        if (mode === 'full' && channel.playlists?.length) {
          for (const id of ids) known.add(id);
          const extra = await collectPlaylists(youtube, show, channel, known);
          extra.tried.forEach((id) => known.add(id));
          for (const [n, list] of extra.found) found.set(n, [...(found.get(n) || []), ...list]);
          report.channels[channel.key] = { playlistVideos: extra.seen };
        }
        done.add(channel.key);
        report.channels[channel.key] = {
          ...(report.channels[channel.key] || {}),
          seen,
          episodes: found.size,
        };
        for (const [n, list] of found) {
          const base = mode === 'full' ? rebuilt.get(n) || [] : after.get(n) || [];
          const merged = mergeSources(base, list);
          if (mode === 'full') rebuilt.set(n, merged);
          else after.set(n, merged);
        }
      } catch (err) {
        report.channels[channel.key] = { error: err.code || 'FAILED' };
        logger.warn({
          message: 'streaming sync: channel failed',
          show: show.tmdbId,
          channel: channel.key,
          code: err.code,
        });
        if (err.code === 'YOUTUBE_QUOTA') {
          report.stoppedEarly = 'quota';
          break;
        }
      }
    }
    if (mode === 'full') {
      // A channel that failed or was never reached keeps what is already stored for it.
      const keep = new Set(show.channels.map((c) => c.key).filter((k) => !done.has(k)));
      for (const [n, list] of before) {
        const mine = list.filter((s) => keep.has(s.c));
        if (mine.length) rebuilt.set(n, mergeSources(rebuilt.get(n) || [], mine));
      }
    }
    if (mode === 'full') after = rebuilt;
  }

  const chunksWritten = await catalog.saveEpisodes(show.tmdbId, after, before);
  const numbers = [...after.keys()].sort((a, b) => a - b);
  const byChannel = {};
  after.forEach((list) =>
    list.forEach((s) => {
      byChannel[s.c] = (byChannel[s.c] || 0) + 1;
    })
  );
  report.episodes = after.size;
  report.latest = numbers[numbers.length - 1] || null;
  report.videosByChannel = byChannel;
  report.chunksWritten = chunksWritten;
  report.quotaUnits = youtube.usage.units - startUnits;
  report.at = Date.now();
  await catalog.saveMeta(show.tmdbId, { title: show.title, lastSync: report });
  return report;
}

module.exports = { syncShow, verifyStored, MODES };
