// Event types for analytics tracking
const EventTypes = {
  // User events
  USER_SIGNUP: 'user.signup',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  
  // Search events
  SEARCH_QUERY: 'search.query',
  SEARCH_RESULT_CLICK: 'search.result_click',
  
  // Movie/TV events
  MOVIE_VIEW: 'movie.view',
  TV_VIEW: 'tv.view',
  MOVIE_DETAILS: 'movie.details',
  TV_DETAILS: 'tv.details',
  
  // User interaction events
  WATCHLIST_ADD: 'watchlist.add',
  WATCHLIST_REMOVE: 'watchlist.remove',
  FAVORITE_ADD: 'favorite.add',
  FAVORITE_REMOVE: 'favorite.remove',
  
  // API events
  API_REQUEST: 'api.request',
  API_ERROR: 'api.error',
  
  // System events
  CACHE_HIT: 'cache.hit',
  CACHE_MISS: 'cache.miss',
};

const EventCategories = {
  USER: 'user',
  SEARCH: 'search',
  CONTENT: 'content',
  INTERACTION: 'interaction',
  API: 'api',
  SYSTEM: 'system',
};

/**
 * Create a standardized event payload
 * @param {string} eventType - Event type from EventTypes
 * @param {object} data - Event data
 * @param {object} metadata - Additional metadata (userId, sessionId, etc.)
 */
function createEvent(eventType, data = {}, metadata = {}) {
  return {
    type: eventType,
    timestamp: Date.now(),
    data,
    metadata: {
      ...metadata,
      environment: process.env.NODE_ENV || 'development',
    },
  };
}

/**
 * Validate event structure
 */
function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('Event must be an object');
  }
  if (!event.type || typeof event.type !== 'string') {
    throw new Error('Event must have a type');
  }
  if (!event.timestamp || typeof event.timestamp !== 'number') {
    throw new Error('Event must have a timestamp');
  }
  return true;
}

module.exports = {
  EventTypes,
  EventCategories,
  createEvent,
  validateEvent,
};
