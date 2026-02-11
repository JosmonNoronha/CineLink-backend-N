const { tmdbConfig } = require('../../config/tmdb');
const { AppError } = require('../../utils/errors');
const { tmdbGet } = require('./client');
const { resolveByImdbId, movieExternalIds, tvExternalIds } = require('./find');
const { getGenreMap } = require('./genres');

function posterUrl(path) {
  if (!path) return 'N/A';
  return `${tmdbConfig.imageBaseUrl}/w500${path}`;
}

function yearFromDate(dateStr) {
  if (!dateStr) return 'N/A';
  const y = String(dateStr).slice(0, 4);
  return y || 'N/A';
}

function parseCompatId(raw) {
  if (!raw) throw new AppError('Missing id', 400, 'VALIDATION_ERROR');
  if (raw.startsWith('tt')) return { kind: 'imdb', imdbId: raw };
  if (raw.startsWith('tmdb:movie:'))
    return { kind: 'tmdb', mediaType: 'movie', tmdbId: raw.split(':').pop() };
  if (raw.startsWith('tmdb:tv:')) return { kind: 'tmdb', mediaType: 'tv', tmdbId: raw.split(':').pop() };
  return { kind: 'unknown', value: raw };
}

async function resolveToTmdb(rawId) {
  const parsed = parseCompatId(rawId);
  if (parsed.kind === 'tmdb') {
    return { media_type: parsed.mediaType, tmdb_id: Number(parsed.tmdbId), imdb_id: null };
  }
  if (parsed.kind === 'imdb') {
    const found = await resolveByImdbId(parsed.imdbId);
    const movie = (found.movie_results || [])[0];
    const tv = (found.tv_results || [])[0];
    if (movie?.id) return { media_type: 'movie', tmdb_id: movie.id, imdb_id: parsed.imdbId };
    if (tv?.id) return { media_type: 'tv', tmdb_id: tv.id, imdb_id: parsed.imdbId };
    throw new AppError('Unable to resolve IMDb ID in TMDB', 404, 'NOT_FOUND');
  }

  // Fallback: if numeric, assume movie
  if (/^\d+$/.test(parsed.value)) {
    return { media_type: 'movie', tmdb_id: Number(parsed.value), imdb_id: null };
  }
  throw new AppError('Unsupported id format', 400, 'VALIDATION_ERROR');
}

async function searchOmdbLike({ q, type, page }) {
  const query = (q || '').trim();
  if (!query) return { Search: [], totalResults: '0', Response: 'False' };

  let endpoint = '/search/multi';
  let mapType = null;
  if (type === 'movie') {
    endpoint = '/search/movie';
    mapType = 'movie';
  } else if (type === 'series' || type === 'tv') {
    endpoint = '/search/tv';
    mapType = 'tv';
  }

  const data = await tmdbGet(endpoint, { query, page });
  const results = Array.isArray(data.results) ? data.results : [];

  // Genre mapping best-effort
  const genreMap = mapType ? await getGenreMap(mapType) : null;

  const Search = results
    .filter((r) => (mapType ? true : r.media_type === 'movie' || r.media_type === 'tv'))
    .map((r) => {
      const mediaType = mapType || r.media_type;
      const title = mediaType === 'tv' ? r.name : r.title;
      const date = mediaType === 'tv' ? r.first_air_date : r.release_date;
      const genres = (r.genre_ids || []).map((id) => (genreMap ? genreMap[id] : null)).filter(Boolean);

      // Extract cast overview if available (TMDb search includes some cast in overview)
      const overview = r.overview || '';

      return {
        Title: title || 'N/A',
        Year: yearFromDate(date),
        imdbID: `tmdb:${mediaType}:${r.id}`,
        Type: mediaType === 'tv' ? 'series' : 'movie',
        Poster: posterUrl(r.poster_path),
        _genres: genres.join(', '),
        Genre: genres.join(', '),
        Actors: overview.substring(0, 100), // Use overview as searchable text
        Director: '', // Will be populated on detail view
        _tmdbId: r.id,
      };
    });

  return {
    Search,
    totalResults: String(data.total_results || Search.length || 0),
    Response: Search.length ? 'True' : 'False',
  };
}

async function movieDetailsOmdbLike({ tmdb_id, imdb_id }) {
  const [movie, credits] = await Promise.all([
    tmdbGet(`/movie/${tmdb_id}`),
    tmdbGet(`/movie/${tmdb_id}/credits`).catch(() => null),
  ]);

  const directors = (credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const writers = (credits?.crew || [])
    .filter((c) => c.department === 'Writing')
    .map((c) => c.name)
    .slice(0, 5);
  const actors = (credits?.cast || []).map((c) => c.name).slice(0, 5);

  let imdbId = imdb_id;
  if (!imdbId) {
    const ex = await movieExternalIds(tmdb_id).catch(() => null);
    imdbId = ex?.imdb_id || null;
  }

  return {
    Title: movie.title || 'N/A',
    Year: yearFromDate(movie.release_date),
    Rated: 'N/A',
    Released: movie.release_date || 'N/A',
    Runtime: movie.runtime ? `${movie.runtime} min` : 'N/A',
    Genre: (movie.genres || []).map((g) => g.name).join(', ') || 'N/A',
    Director: directors.join(', ') || 'N/A',
    Writer: writers.join(', ') || 'N/A',
    Actors: actors.join(', ') || 'N/A',
    Plot: movie.overview || 'N/A',
    Language: movie.original_language || 'N/A',
    Country: (movie.production_countries || []).map((c) => c.name).join(', ') || 'N/A',
    Awards: 'N/A',
    Poster: posterUrl(movie.poster_path),
    imdbRating: movie.vote_average ? String(movie.vote_average.toFixed(1)) : 'N/A',
    imdbVotes: movie.vote_count ? String(movie.vote_count) : 'N/A',
    imdbID: imdbId || `tmdb:movie:${tmdb_id}`,
    Type: 'movie',
  };
}

async function tvDetailsOmdbLike({ tmdb_id, imdb_id }) {
  const tv = await tmdbGet(`/tv/${tmdb_id}`);

  let imdbId = imdb_id;
  if (!imdbId) {
    const ex = await tvExternalIds(tmdb_id).catch(() => null);
    imdbId = ex?.imdb_id || null;
  }

  return {
    Title: tv.name || 'N/A',
    Year: yearFromDate(tv.first_air_date),
    Rated: 'N/A',
    Released: tv.first_air_date || 'N/A',
    Runtime:
      Array.isArray(tv.episode_run_time) && tv.episode_run_time.length
        ? `${tv.episode_run_time[0]} min`
        : 'N/A',
    Genre: (tv.genres || []).map((g) => g.name).join(', ') || 'N/A',
    Director: 'N/A',
    Writer: 'N/A',
    Actors: 'N/A',
    Plot: tv.overview || 'N/A',
    Language: tv.original_language || 'N/A',
    Country: (tv.origin_country || []).join(', ') || 'N/A',
    Awards: 'N/A',
    Poster: posterUrl(tv.poster_path),
    imdbRating: tv.vote_average ? String(tv.vote_average.toFixed(1)) : 'N/A',
    imdbVotes: tv.vote_count ? String(tv.vote_count) : 'N/A',
    imdbID: imdbId || `tmdb:tv:${tmdb_id}`,
    Type: 'series',
    totalSeasons: tv.number_of_seasons || 0,
  };
}

async function seasonOmdbLike({ tmdb_tv_id, season_number }) {
  const data = await tmdbGet(`/tv/${tmdb_tv_id}/season/${season_number}`);
  const Episodes = (data.episodes || []).map((ep) => ({
    Title: ep.name || 'N/A',
    Released: ep.air_date || 'N/A',
    Episode: String(ep.episode_number || ''),
    imdbRating: ep.vote_average ? String(ep.vote_average.toFixed(1)) : 'N/A',
    Runtime: ep.runtime ? `${ep.runtime} min` : 'N/A',
  }));
  return { Season: String(season_number), Episodes, Response: Episodes.length ? 'True' : 'False' };
}

async function episodeOmdbLike({ tmdb_tv_id, season_number, episode_number }) {
  const data = await tmdbGet(`/tv/${tmdb_tv_id}/season/${season_number}/episode/${episode_number}`);
  return {
    Title: data.name || 'N/A',
    Released: data.air_date || 'N/A',
    Season: String(season_number),
    Episode: String(episode_number),
    Runtime: data.runtime ? `${data.runtime} min` : 'N/A',
    imdbRating: 'N/A',
    Response: 'True',
  };
}

async function searchPeople({ q, page = 1 }) {
  const query = (q || '').trim();
  if (!query) return { results: [], totalResults: 0 };

  const data = await tmdbGet('/search/person', { query, page });
  const people = Array.isArray(data.results) ? data.results : [];

  // Get movies/TV shows for each person (limit to top 3 people)
  const results = await Promise.all(
    people.slice(0, 3).map(async (person) => {
      try {
        // Get person's movie and TV credits
        const credits = await tmdbGet(`/person/${person.id}/combined_credits`);
        const cast = credits.cast || [];
        const crew = credits.crew || [];

        // Filter for actual starring roles (not guest appearances)
        // Include both movies and TV shows
        const significantWorks = [
          // Cast: movies and TV shows with character names
          ...cast.filter(
            (w) =>
              (w.media_type === 'movie' || w.media_type === 'tv') &&
              w.character &&
              w.character.trim() !== '' &&
              (w.vote_count || 0) > 50 // Has some votes
          ),
          // Crew: directors for movies, creators/producers for TV
          ...crew.filter(
            (w) =>
              (w.media_type === 'movie' && w.job === 'Director') ||
              (w.media_type === 'tv' && (w.job === 'Executive Producer' || w.job === 'Creator'))
          ),
        ];

        // Sort by popularity and vote count
        const topWorks = significantWorks
          .sort((a, b) => {
            const scoreA = (a.popularity || 0) * Math.log10((a.vote_count || 1) + 1);
            const scoreB = (b.popularity || 0) * Math.log10((b.vote_count || 1) + 1);
            return scoreB - scoreA;
          })
          .slice(0, 20) // Get top 20 results (mix of movies and TV)
          .map((work) => {
            const mediaType = work.media_type;
            const title = mediaType === 'tv' ? work.name : work.title;
            const date = mediaType === 'tv' ? work.first_air_date : work.release_date;
            const rating = work.vote_average || 0;

            return {
              Title: title || 'N/A',
              Year: yearFromDate(date),
              imdbID: `tmdb:${mediaType}:${work.id}`,
              Type: mediaType === 'tv' ? 'series' : 'movie',
              Poster: posterUrl(work.poster_path),
              Actors: person.name, // Tag with actor/director name
              imdbRating: rating > 0 ? rating.toFixed(1) : 'N/A',
              _tmdbId: work.id,
              _personMatch: person.name, // Flag this as from person search
              _popularity: work.popularity,
            };
          });

        return topWorks;
      } catch (error) {
        return [];
      }
    })
  );

  // Flatten results
  const flatResults = results.flat();

  return {
    results: flatResults,
    totalResults: flatResults.length,
  };
}

async function searchByGenreOmdbLike({ genreResults }) {
  if (!genreResults || !genreResults.results || genreResults.results.length === 0) {
    return { Search: [], totalResults: '0', Response: 'False' };
  }

  const Search = await Promise.all(
    genreResults.results.map(async (r) => {
      const mediaType = r.media_type || (r.first_air_date ? 'tv' : 'movie');
      const title = mediaType === 'tv' ? r.name : r.title;
      const date = mediaType === 'tv' ? r.first_air_date : r.release_date;
      const rating = r.vote_average || 0;

      // Get genre names
      const genreMap = await getGenreMap(mediaType);
      const genres = (r.genre_ids || []).map((id) => genreMap[id]).filter(Boolean);

      return {
        Title: title || 'N/A',
        Year: yearFromDate(date),
        imdbID: `tmdb:${mediaType}:${r.id}`,
        Type: mediaType === 'tv' ? 'series' : 'movie',
        Poster: posterUrl(r.poster_path),
        Genre: genres.join(', '),
        imdbRating: rating > 0 ? rating.toFixed(1) : 'N/A',
        _tmdbId: r.id,
        _isGenreSearch: true,
      };
    })
  );

  return {
    Search,
    totalResults: String(genreResults.totalResults || Search.length),
    Response: 'True',
  };
}

module.exports = {
  resolveToTmdb,
  searchOmdbLike,
  searchPeople,
  searchByGenreOmdbLike,
  movieDetailsOmdbLike,
  tvDetailsOmdbLike,
  seasonOmdbLike,
  episodeOmdbLike,
};
