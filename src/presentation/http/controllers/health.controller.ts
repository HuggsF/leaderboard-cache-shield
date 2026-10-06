import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthOutput } from '@application/dtos/health.dto';
import type { Result } from '@domain/shared/result';

export type CheckHealth = { execute(): Promise<Result<HealthOutput, never>> };

export class HealthController {
  constructor(private readonly checkHealth: CheckHealth) {}

  /** GET /health — 200 when MySQL and Redis are up, 503 otherwise (load balancer friendly). */
  check = async (_request: FastifyRequest, reply: FastifyReply): Promise<HealthOutput> => {
    const result = await this.checkHealth.execute();
    if (!result.success) {
      throw new Error('CheckHealthUseCase cannot fail');
    }
    void reply.status(result.data.status === 'ok' ? 200 : 503);
    return result.data;
  };
}
