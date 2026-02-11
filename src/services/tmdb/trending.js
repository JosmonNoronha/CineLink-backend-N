const { tmdbGet } = require('./client');
const { cacheGet, cacheSet } = require('./cache');

async function cached(path, params, ttlSeconds) {
  const key = `tmdb:${path}:${JSON.stringify(params || {})}`;
  const hit = await cacheGet(key);
  if (hit) return { data: hit, source: 'cache' };
  const data = await tmdbGet(path, params);
  await cacheSet(key, data, ttlSeconds);
  return { data, source: 'tmdb' };
}

async function trending(type, time_window) {
  const result = await cached(`/trending/${type}/${time_window}`, {}, 3 * 60 * 60);

  // Filter out person results if data has results array
  if (result.data?.results && Array.isArray(result.data.results)) {
    result.data.results = result.data.results.filter((item) => {
      // For specific type requests (movie/tv), filter by media_type
      if (type === 'movie') return item.media_type === 'movie';
      if (type === 'tv') return item.media_type === 'tv';
      // For 'all', exclude persons but keep movies and TV
      if (type === 'all') return item.media_type === 'movie' || item.media_type === 'tv';
      return true;
    });
  }

  return result;
}

async function getTrendingSearchKeywords() {
  const cacheKey = 'trending:search:keywords';
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Get trending movies and TV shows
    const [moviesResult, tvResult] = await Promise.all([trending('movie', 'week'), trending('tv', 'week')]);

    const keywords = [];

    // Extract movie titles
    if (moviesResult.data?.results) {
      moviesResult.data.results.slice(0, 10).forEach((movie) => {
        if (movie.title) keywords.push(movie.title);
      });
    }

    // Extract TV show titles
    if (tvResult.data?.results) {
      tvResult.data.results.slice(0, 10).forEach((show) => {
        if (show.name) keywords.push(show.name);
      });
    }

    // Add some popular genre-based searches (single keywords now supported)
    const popularSearches = [
      'action',
      'comedy',
      'thriller',
      'horror',
      'anime',
      'drama',
      'romance',
      'sci-fi',
      'documentary',
    ];

    const allKeywords = [...keywords, ...popularSearches].slice(0, 30);

    // Cache for 6 hours
    await cacheSet(cacheKey, allKeywords, 6 * 60 * 60);

    return allKeywords;
  } catch (error) {
    // Fallback to basic keywords on error
    return [
      'action',
      'comedy',
      'drama',
      'thriller',
      'horror',
      'sci-fi',
      'anime',
      'romance',
      'adventure',
      'fantasy',
      'documentary',
      'mystery',
    ];
  }
}

module.exports = { trending, getTrendingSearchKeywords };
