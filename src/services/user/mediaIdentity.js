function safeString(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out.length ? out : null;
}

function parseLegacyImdbId(rawId) {
  const id = safeString(rawId);
  if (!id) return { key: null, tmdbId: null, imdbId: null, mediaType: null };

  if (id.startsWith('tmdb:')) {
    const parts = id.split(':');
    if (parts.length === 3) {
      const mediaType = parts[1] === 'tv' ? 'tv' : 'movie';
      const tmdbId = Number(parts[2]);
      if (Number.isFinite(tmdbId) && tmdbId > 0) {
        return {
          key: `tmdb:${mediaType}:${tmdbId}`,
          tmdbId,
          imdbId: null,
          mediaType,
        };
      }
    }
  }

  if (id.startsWith('tt')) {
    return {
      key: `imdb:${id}`,
      tmdbId: null,
      imdbId: id,
      mediaType: null,
    };
  }

  return {
    key: `legacy:${id}`,
    tmdbId: null,
    imdbId: null,
    mediaType: null,
  };
}

function inferMediaType(item = {}, fallbackType = null) {
  if (item.media_type === 'tv' || item.media_type === 'movie') return item.media_type;
  if (item.Type === 'series') return 'tv';
  if (item.Type === 'movie') return 'movie';
  return fallbackType;
}

function normalizeMediaItem(item = {}) {
  const metadata = item && item.metadata && typeof item.metadata === 'object' ? item.metadata : item;

  const tmdbFromObject = Number(item.tmdb_id || metadata.tmdb_id || metadata.id);
  const hasTmdb = Number.isFinite(tmdbFromObject) && tmdbFromObject > 0;

  const parsedLegacy = parseLegacyImdbId(item.imdbID || metadata.imdbID);
  const mediaType = inferMediaType(item, parsedLegacy.mediaType || inferMediaType(metadata, null) || 'movie');

  const tmdbId = hasTmdb ? tmdbFromObject : parsedLegacy.tmdbId;
  const imdbId = safeString(item.imdbId || metadata.imdbId || parsedLegacy.imdbId);

  const key =
    tmdbId && mediaType
      ? `tmdb:${mediaType}:${tmdbId}`
      : imdbId
        ? `imdb:${imdbId}`
        : parsedLegacy.key || null;

  const imdbID = tmdbId && mediaType ? `tmdb:${mediaType}:${tmdbId}` : imdbId || item.imdbID || null;

  return {
    schemaVersion: 1,
    id: {
      key,
      tmdbId: tmdbId || null,
      imdbId: imdbId || null,
      mediaType: mediaType || null,
    },
    imdbID,
    tmdb_id: tmdbId || null,
    media_type: mediaType || null,
    title: safeString(item.title || metadata.title || metadata.name || item.Title || metadata.Title),
    poster: safeString(item.poster || metadata.poster || item.Poster || metadata.Poster),
    year: safeString(item.year || metadata.year || item.Year || metadata.Year),
    watched: Boolean(item.watched || metadata.watched),
    metadata,
  };
}

function isSameMedia(a, b) {
  const left = a && a.id ? a.id : {};
  const right = b && b.id ? b.id : {};

  if (left.key && right.key) return left.key === right.key;

  if (left.tmdbId && right.tmdbId) {
    return String(left.tmdbId) === String(right.tmdbId) && left.mediaType === right.mediaType;
  }

  if (left.imdbId && right.imdbId) return left.imdbId === right.imdbId;

  return false;
}

module.exports = {
  normalizeMediaItem,
  isSameMedia,
  parseLegacyImdbId,
};
