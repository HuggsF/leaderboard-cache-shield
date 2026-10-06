import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ExportMetricsOutput } from '@application/dtos/metrics.dto';
import type { Result } from '@domain/shared/result';

export type ExportMetrics = { execute(): Result<ExportMetricsOutput, never> };

export class MetricsController {
  constructor(private readonly exportMetrics: ExportMetrics) {}

  /** GET /metrics — Prometheus text exposition format. */
  scrape = (_request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const result = this.exportMetrics.execute();
    if (!result.success) {
      throw new Error('ExportMetricsUseCase cannot fail');
    }
    const { contentType, body } = result.data;
    return reply.type(contentType).header('cache-control', 'no-store').send(body);
  };
}
