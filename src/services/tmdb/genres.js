const { tmdbGet } = require('./client');
const { cacheGet, cacheSet } = require('./cache');

async function getGenreMap(type) {
  const key = `tmdb:genres:${type}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const data = await tmdbGet(`/genre/${type}/list`);
  const map = {};
  for (const g of data.genres || []) map[g.id] = g.name;
  await cacheSet(key, map, 7 * 24 * 60 * 60);
  return map;
}

// Genre keyword to ID mapping
const GENRE_KEYWORDS = {
  // Movies & TV
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'science fiction': 878,
  'sci-fi': 878,
  'sci fi': 878,
  scifi: 878,
  thriller: 53,
  war: 10752,
  western: 37,
  // TV specific
  'action & adventure': 10759,
  kids: 10762,
  news: 10763,
  reality: 10764,
  soap: 10766,
  talk: 10767,
  'war & politics': 10768,
};

// Special keywords
const SPECIAL_KEYWORDS = {
  anime: { keyword: 210, genre: 16 }, // Animation genre + anime keyword
  bollywood: { keyword: 1562, originCountry: 'IN' },
  hollywood: { originCountry: 'US' },
  korean: { originCountry: 'KR' },
  japanese: { originCountry: 'JP' },
};

async function searchByGenre({ genre, type, page = 1 }) {
  const genreLower = genre.toLowerCase().trim();

  // Check for special keywords
  if (SPECIAL_KEYWORDS[genreLower]) {
    return searchBySpecialKeyword(genreLower, type, page);
  }

  // Check for genre keywords
  const genreId = GENRE_KEYWORDS[genreLower];
  if (!genreId) {
    return { results: [], totalResults: 0 };
  }

  // Search movies or TV shows with this genre
  const mediaType = type === 'series' ? 'tv' : type === 'movie' ? 'movie' : null;
  const results = [];

  if (!mediaType || mediaType === 'movie') {
    const movieData = await tmdbGet('/discover/movie', {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      page,
    });
    results.push(...(movieData.results || []));
  }

  if (!mediaType || mediaType === 'tv') {
    const tvData = await tmdbGet('/discover/tv', {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      page,
    });
    results.push(...(tvData.results || []));
  }

  return {
    results: results.slice(0, 20),
    totalResults: results.length,
  };
}

async function searchBySpecialKeyword(keyword, type, page) {
  const config = SPECIAL_KEYWORDS[keyword];
  const mediaType = type === 'series' ? 'tv' : type === 'movie' ? 'movie' : null;
  const results = [];

  if (!mediaType || mediaType === 'movie') {
    const params = {
      sort_by: 'popularity.desc',
      page,
    };
    if (config.genre) params.with_genres = config.genre;
    if (config.keyword) params.with_keywords = config.keyword;
    if (config.originCountry) params.with_origin_country = config.originCountry;

    const movieData = await tmdbGet('/discover/movie', params);
    results.push(...(movieData.results || []));
  }

  if (!mediaType || mediaType === 'tv') {
    const params = {
      sort_by: 'popularity.desc',
      page,
    };
    if (config.genre) params.with_genres = config.genre;
    if (config.keyword) params.with_keywords = config.keyword;
    if (config.originCountry) params.with_origin_country = config.originCountry;

    const tvData = await tmdbGet('/discover/tv', params);
    results.push(...(tvData.results || []));
  }

  return {
    results: results.slice(0, 20),
    totalResults: results.length,
  };
}

module.exports = { getGenreMap, searchByGenre, GENRE_KEYWORDS, SPECIAL_KEYWORDS };
