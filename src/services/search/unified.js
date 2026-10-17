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

const foldText = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: Amélie → Amelie
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
 
/**
 * Re-rank TMDb title results so the title the user typed comes first.
 *   tier 0: exact title match ("Heat", "Spider-Man" for "spiderman")
 *           ties broken by popularity (2022 movie beats obscure 2004 series)
 *   tier 1: title starts with the query as a whole word ("Alien: Romulus")
 *   tier 2: everything else, in TMDb's original order
 * A trailing year ("Dune 2021") is ignored when matching.
 */
function rankTitles(items, query) {
  const list = Array.isArray(items) ? items : [];
  const q = foldText(String(query || '').replace(/\s+\(?(?:19|20)\d{2}\)?$/, ''));
  if (!q) return list;
  const qCompact = q.replace(/ /g, '');
 
  const tierOf = (item) => {
    const t = foldText(item.Title);
    if (t === q || t.replace(/ /g, '') === qCompact) return 0;
    if (t.startsWith(`${q} `)) return 1;
    return 2;
  };
 
  return list
    .map((item, index) => ({ item, index, tier: tierOf(item) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier <= 1) {
        const diff = (b.item._popularity || 0) - (a.item._popularity || 0);
        if (diff !== 0) return diff;
      }
      return a.index - b.index;
    })
    .map((x) => x.item);
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
  const personPromise =
  effectivePage === 1 && shouldRunPersonSearch(normalizedQuery)
    ? searchPeople({ q: normalizedQuery, page: 1, strict: true })
    : Promise.resolve({ results: [], totalResults: 0, totalPages: 0, peopleTotalResults: 0 });

  const [titleData, personData] = await Promise.all([titlePromise, personPromise]);

  const rankedTitles = rankTitles(titleData.Search, normalizedQuery);
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

  const strong = personData.results.some((w) => w._strongMatch);
if (strong) {
  pushUnique(personData.results.slice(0, 20));  // "Tom Hanks" → his films first
  pushUnique(rankedTitles);
} else {
  pushUnique(rankedTitles);                 // "Heat" → the movie first
  pushUnique(personData.results.slice(0, 8));
}

  if (normType) {
    const filteredResults = mergedResults.filter((item) => item.Type === normType);
    mergedResults.splice(0, mergedResults.length, ...filteredResults);
  }

  const titleTotalResults = parseInt(titleData.totalResults || '0', 10) || 0;
  const titleTotalPages = titleData.totalPages || Math.max(1, Math.ceil(titleTotalResults / 20));
  const personTotalResults = parseInt(personData.totalResults || '0', 10) || 0;
  const personTotalPages = 0;

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
