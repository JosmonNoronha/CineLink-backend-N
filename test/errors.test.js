const request = require('supertest');
const express = require('express');

const { correlationIdMiddleware } = require('../src/middleware/correlationId');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const { AppError } = require('../src/utils/errors');
const { NetworkError, ValidationError } = require('../src/utils/errorTypes');

describe('Error handling middleware', () => {
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(correlationIdMiddleware);

    app.get('/boom', (_req, _res, next) => {
      next(new Error('Unexpected boom'));
    });

    app.get('/validation', (_req, _res, next) => {
      next(new ValidationError('Input invalid', [{ field: 'query', message: 'Required' }]));
    });

    app.get('/network', (_req, _res, next) => {
      next(new NetworkError('TMDB timeout'));
    });

    app.get('/app-error', (_req, _res, next) => {
      next(
        new AppError(
          'Custom app error',
          409,
          'CONFLICT',
          { resource: 'favorite' },
          {
            userMessage: 'This item already exists.',
            retryable: false,
          }
        )
      );
    });

    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  };

  test('propagates incoming correlation id in error payload', async () => {
    const app = buildApp();
    const res = await request(app).get('/boom').set('X-Correlation-Id', 'req-123');

    expect(res.status).toBe(500);
    expect(res.headers['x-correlation-id']).toBe('req-123');
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        correlationId: 'req-123',
      },
    });
  });

  test('returns structured validation error with details', async () => {
    const app = buildApp();
    const res = await request(app).get('/validation');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        userMessage: 'Please check your input and try again.',
        retryable: false,
      },
    });
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  test('returns retryable network error', async () => {
    const app = buildApp();
    const res = await request(app).get('/network');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NETWORK_ERROR');
    expect(res.body.error.retryable).toBe(true);
  });

  test('returns AppError custom user message and details', async () => {
    const app = buildApp();
    const res = await request(app).get('/app-error');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'CONFLICT',
        userMessage: 'This item already exists.',
        retryable: false,
      },
    });
    expect(res.body.error.details).toEqual({ resource: 'favorite' });
  });

  test('notFound includes correlation id and stable envelope', async () => {
    const app = buildApp();
    const res = await request(app).get('/missing-route').set('X-Correlation-Id', 'cid-404');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
        correlationId: 'cid-404',
        retryable: false,
      },
    });
  });
});
