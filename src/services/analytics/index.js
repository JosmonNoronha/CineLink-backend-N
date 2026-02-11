const { EventTypes, EventCategories, createEvent, validateEvent } = require('./events');
const metrics = require('./metrics');
const storage = require('./storage');
const { logger } = require('../../utils/logger');

/**
 * Main analytics service
 */
class AnalyticsService {
  constructor() {
    this.eventQueue = [];
    this.flushInterval = null;
    this.isProcessing = false;
  }

  /**
   * Initialize the analytics service
   */
  initialize() {
    // Flush events every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushEvents();
    }, 30000);

    logger.info('Analytics service initialized');
  }

  /**
   * Shutdown the analytics service
   */
  async shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flushEvents();
    logger.info('Analytics service shutdown');
  }

  /**
   * Track an event
   * @param {string} eventType - Event type from EventTypes
   * @param {object} data - Event data
   * @param {object} metadata - Additional metadata
   */
  trackEvent(eventType, data = {}, metadata = {}) {
    try {
      const event = createEvent(eventType, data, metadata);
      validateEvent(event);
      
      this.eventQueue.push(event);

      // Flush if queue is getting large
      if (this.eventQueue.length >= 100) {
        this.flushEvents();
      }

      return true;
    } catch (error) {
      logger.error('Failed to track event', { eventType, error: error.message });
      return false;
    }
  }

  /**
   * Flush queued events to storage
   */
  async flushEvents() {
    if (this.isProcessing || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const eventsToProcess = [...this.eventQueue];
    this.eventQueue = [];

    try {
      // Store events in batches
      const batchSize = 50;
      for (let i = 0; i < eventsToProcess.length; i += batchSize) {
        const batch = eventsToProcess.slice(i, i + batchSize);
        await Promise.all(batch.map((event) => storage.storeEvent(event)));
      }

      logger.debug(`Flushed ${eventsToProcess.length} events to storage`);
    } catch (error) {
      logger.error('Failed to flush events', { error: error.message });
      // Re-queue failed events
      this.eventQueue.unshift(...eventsToProcess);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get analytics overview
   */
  async getOverview() {
    return await metrics.getOverviewMetrics();
  }

  /**
   * Get popular searches
   */
  async getPopularSearches(limit = 10) {
    return await metrics.getPopularSearches(limit);
  }

  /**
   * Get popular content
   */
  async getPopularContent(limit = 10) {
    const [movies, tvShows] = await Promise.all([
      metrics.getPopularMovies(limit),
      metrics.getPopularTVShows(limit),
    ]);

    return { movies, tvShows };
  }

  /**
   * Get user engagement metrics
   */
  async getUserEngagement() {
    const activeUsers = await metrics.getActiveUsersCount();

    return {
      activeUsersToday: activeUsers,
      // Add more engagement metrics as needed
    };
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics() {
    return await metrics.getPerformanceMetrics();
  }
}

// Singleton instance
const analyticsService = new AnalyticsService();

module.exports = {
  analyticsService,
  EventTypes,
  EventCategories,
  metrics,
  storage,
};
