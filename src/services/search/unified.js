const { searchOmdbLike, searchPeople, searchByGenreOmdbLike } = require('../tmdb/compat');
const { searchByGenre } = require('../tmdb/genres');
const { AppError } = require('../../utils/errors');

const GENRE_KEYWORDS_LIST = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'history',
  'horror',
  'music',
  'mystery',
  'romance',
  'science fiction',
  'sci-fi',
  'sci fi',
  'scifi',
  'thriller',
  'war',
  'western',
  'anime',
  'bollywood',
  'hollywood',
  'korean',
  'japanese',
  'kids',
  'reality',
  'soap',
  'talk',
];

function normalizeQuery(query) {
  return String(query || '').trim().replace(/\s+/g, ' ');
}

function isGenreSearch(query) {
  const queryLower = normalizeQuery(query).toLowerCase();
  return GENRE_KEYWORDS_LIST.some((keyword) => queryLower === keyword || queryLower === `${keyword}s`);
}

function shouldRunPersonSearch(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return false;
  if (isGenreSearch(normalized)) return false;
  if (!/^[a-zA-Z0-9\s.'-]+$/.test(normalized)) return false;
  return normalized.length >= 3;
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded;
  } catch (_e) {
    return null;
  }
}

async function unifiedSearch({ query, type = 'all', page = 1, filters, cursor }) {
  const normalizedQuery = normalizeQuery(query);
  void filters;

  const decodedCursor =
    typeof cursor === 'string' && cursor.trim().length > 0 ? decodeCursor(cursor) : null;

  if (cursor && !decodedCursor) {
    throw new AppError('Invalid cursor', 400, 'VALIDATION_ERROR');
  }

  if (
    decodedCursor &&
    (normalizeQuery(decodedCursor.query) !== normalizedQuery ||
      (decodedCursor.type || 'all') !== (type || 'all'))
  ) {
    throw new AppError('Cursor does not match query context', 400, 'VALIDATION_ERROR');
  }

  const effectivePage = decodedCursor?.page || page;

  if (!normalizedQuery) {
    return {
      Search: [],
      totalResults: '0',
      Response: 'False',
      meta: {
        hasMore: false,
        isTotalExact: true,
        source: 'empty',
      },
    };
  }

  const normType = type && type !== 'all' ? type : undefined;

  if (isGenreSearch(normalizedQuery)) {
    const genreResults = await searchByGenre({
      genre: normalizedQuery,
      type: normType,
      page: effectivePage,
    });
    const formatted = await searchByGenreOmdbLike({ genreResults });
    const totalResults = parseInt(formatted.totalResults, 10) || formatted.Search.length;
    const totalPages = genreResults.totalPages || Math.max(1, Math.ceil(totalResults / 20));
    const hasMore = effectivePage < totalPages;

    return {
      ...formatted,
      meta: {
        hasMore,
        isTotalExact: true,
        source: 'genre',
        totalResultsExact: totalResults,
        totalResultsEstimated: totalResults,
        nextCursor: hasMore
          ? encodeCursor({ query: normalizedQuery, type, page: effectivePage + 1, source: 'genre' })
          : null,
        sources: {
          genre: {
            totalResults,
            totalPages,
          },
        },
      },
    };
  }

  const titlePromise = searchOmdbLike({ q: normalizedQuery, type: normType, page: effectivePage });
  const personPromise = shouldRunPersonSearch(normalizedQuery)
    ? searchPeople({ q: normalizedQuery, page: effectivePage })
    : Promise.resolve({ results: [], totalResults: 0, totalPages: 0, peopleTotalResults: 0 });

  const [titleData, personData] = await Promise.all([titlePromise, personPromise]);

  const mergedResults = [];
  const seenIds = new Set();

  const pushUnique = (items) => {
    (items || []).forEach((item) => {
      if (!item || !item.imdbID || seenIds.has(item.imdbID)) {
        return;
      }
      seenIds.add(item.imdbID);
      mergedResults.push(item);
    });
  };

  pushUnique(personData.results);
  pushUnique(titleData.Search);

  if (normType) {
    const filteredResults = mergedResults.filter((item) => item.Type === normType);
    mergedResults.splice(0, mergedResults.length, ...filteredResults);
  }

  const titleTotalResults = parseInt(titleData.totalResults || '0', 10) || 0;
  const titleTotalPages = titleData.totalPages || Math.max(1, Math.ceil(titleTotalResults / 20));
  const personTotalResults = parseInt(personData.totalResults || '0', 10) || 0;
  const personTotalPages = personData.totalPages || (personTotalResults > 0 ? effectivePage : 0);

  const hasMore = Math.max(titleTotalPages, personTotalPages) > effectivePage;
  const totalResultsEstimated = Math.max(
    titleTotalResults + personTotalResults,
    mergedResults.length,
  );

  return {
    Search: mergedResults,
    totalResults: String(totalResultsEstimated),
    Response: mergedResults.length ? 'True' : 'False',
    meta: {
      hasMore,
      isTotalExact: false,
      source: personData.results.length > 0 ? 'blended' : 'title',
      totalResultsExact: null,
      totalResultsEstimated,
      nextCursor: hasMore
        ? encodeCursor({
            query: normalizedQuery,
            type,
            page: effectivePage + 1,
            source: personData.results.length > 0 ? 'blended' : 'title',
          })
        : null,
      sources: {
        title: {
          totalResults: titleTotalResults,
          totalPages: titleTotalPages,
        },
        person: {
          totalResults: personTotalResults,
          totalPages: personTotalPages,
        },
      },
    },
  };
}

module.exports = {
  unifiedSearch,
  isGenreSearch,
  shouldRunPersonSearch,
  normalizeQuery,
};
