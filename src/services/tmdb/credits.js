const { tmdbConfig } = require('../../config/tmdb');

const MAX_CAST_MEMBERS = 15;

function normalizeCredits(data) {
  const cast = Array.isArray(data?.cast) ? data.cast : [];

  return {
    cast: cast
      .filter((person) => person && person.name)
      .slice(0, MAX_CAST_MEMBERS)
      .map((person, index) => ({
        id: person.id || `${person.name}-${index}`,
        name: person.name,
        character: person.character || null,
        profilePath: person.profile_path || null,
        profileUrl: person.profile_path
          ? `${tmdbConfig.imageBaseUrl}/w185${person.profile_path}`
          : null,
        order: Number.isInteger(person.order) ? person.order : index,
      })),
  };
}

module.exports = { MAX_CAST_MEMBERS, normalizeCredits };
