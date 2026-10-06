import type { FastifyReply, FastifyRequest } from 'fastify';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { ok } from '@domain/shared/result';

describe('HealthController', () => {
  it('returns 200 when all dependencies are healthy', async () => {
    const checkHealth = {
      execute: jest.fn().mockResolvedValue(
        ok({
          status: 'ok',
          uptimeSeconds: 120,
          services: {
            mysql: { status: 'up', latencyMs: 2 },
            redis: { status: 'up', latencyMs: 1 },
          },
        }),
      ),
    };

    const controller = new HealthController(checkHealth);
    const reply = {
      status: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    const req = {} as FastifyRequest;

    const body = await controller.check(req, reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(body.status).toBe('ok');
  });

  it('returns 503 when a dependency is degraded', async () => {
    const checkHealth = {
      execute: jest.fn().mockResolvedValue(
        ok({
          status: 'degraded',
          uptimeSeconds: 120,
          services: {
            mysql: { status: 'down', latencyMs: 50 },
            redis: { status: 'up', latencyMs: 1 },
          },
        }),
      ),
    };

    const controller = new HealthController(checkHealth);
    const reply = {
      status: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    const req = {} as FastifyRequest;

    const body = await controller.check(req, reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(body.status).toBe('degraded');
  });
});
