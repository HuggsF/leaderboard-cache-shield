import type { FastifyBaseLogger } from 'fastify';
import { ok } from '@domain/shared/result';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { LeaderboardController } from '@presentation/http/controllers/leaderboard.controller';
import { MetricsController } from '@presentation/http/controllers/metrics.controller';
import { createHttpApp } from '@presentation/http/app';
import { leaderboardDto } from '../../support/fakes';

describe('createHttpApp', () => {
  const dto = leaderboardDto();
  const loggerMock = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as FastifyBaseLogger;

  const leaderboardUseCases = {
    naive: {
      execute: jest.fn().mockResolvedValue(ok({ leaderboard: dto, cacheStatus: 'MISS' })),
    },
    lock: {
      execute: jest.fn().mockResolvedValue(ok({ leaderboard: dto, cacheStatus: 'HIT' })),
    },
    swr: {
      execute: jest.fn().mockResolvedValue(ok({ leaderboard: dto, cacheStatus: 'STALE' })),
    },
  };

  const healthUseCase = {
    execute: jest.fn().mockResolvedValue(
      ok({
        status: 'ok',
        uptimeSeconds: 10,
        services: { mysql: { status: 'up' }, redis: { status: 'up' } },
      }),
    ),
  };

  const metricsUseCase = {
    execute: jest.fn().mockReturnValue(
      ok({
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        body: '# HELP metrics\n',
      }),
    ),
  };

  const app = createHttpApp({
    logger: loggerMock,
    logRequests: false,
    leaderboardController: new LeaderboardController(leaderboardUseCases),
    healthController: new HealthController(healthUseCase),
    metricsController: new MetricsController(metricsUseCase),
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles GET /api/v1/leaderboard with x-request-id and cache headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/leaderboard?page=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-cache']).toBe('MISS');
    expect(response.headers['x-cache-strategy']).toBe('naive');
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.json()).toEqual(dto);
  });

  it('handles GET /api/v2/leaderboard', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/leaderboard?page=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-cache']).toBe('HIT');
    expect(response.headers['x-cache-strategy']).toBe('lock');
  });

  it('handles GET /api/v3/leaderboard', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v3/leaderboard?page=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-cache']).toBe('STALE');
    expect(response.headers['x-cache-strategy']).toBe('swr');
  });

  it('handles GET /health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({ status: 'ok' }));
  });

  it('handles GET /metrics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(response.body).toBe('# HELP metrics\n');
  });

  it('returns 404 for unknown route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/unknown-route',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /unknown-route not found',
      },
    });
  });

  it('returns 400 for invalid query parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/leaderboard?page=invalid',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('VALIDATION_ERROR');
  });
});
