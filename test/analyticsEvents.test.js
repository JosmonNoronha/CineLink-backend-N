const {
  EventTypes,
  EventCategories,
  createEvent,
  validateEvent,
} = require('../src/services/analytics/events');

describe('analytics events helpers', () => {
  test('exports known event types and categories', () => {
    expect(EventTypes.SEARCH_QUERY).toBe('search.query');
    expect(EventCategories.SEARCH).toBe('search');
  });

  test('createEvent builds normalized payload with environment metadata', () => {
    process.env.NODE_ENV = 'test';
    const event = createEvent('search.query', { query: 'matrix' }, { userId: 'u1' });

    expect(event.type).toBe('search.query');
    expect(typeof event.timestamp).toBe('number');
    expect(event.data).toEqual({ query: 'matrix' });
    expect(event.metadata).toMatchObject({ userId: 'u1', environment: 'test' });
  });

  test('validateEvent accepts valid event and rejects malformed payloads', () => {
    const valid = {
      type: 'search.query',
      timestamp: Date.now(),
      data: {},
      metadata: {},
    };

    expect(validateEvent(valid)).toBe(true);
    expect(() => validateEvent(null)).toThrow('Event must be an object');
    expect(() => validateEvent({ timestamp: Date.now() })).toThrow('Event must have a type');
    expect(() => validateEvent({ type: 'x', timestamp: 'bad' })).toThrow('Event must have a timestamp');
  });
});
