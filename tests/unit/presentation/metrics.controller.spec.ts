import type { FastifyReply, FastifyRequest } from 'fastify';
import { MetricsController } from '@presentation/http/controllers/metrics.controller';
import { ok } from '@domain/shared/result';

describe('MetricsController', () => {
  it('serves Prometheus text exposition format with correct headers', () => {
    const exportMetrics = {
      execute: jest.fn().mockReturnValue(
        ok({
          contentType: 'text/plain; version=0.0.4; charset=utf-8',
          body: '# HELP cache_hits_total...\ncache_hits_total 42\n',
        }),
      ),
    };

    const controller = new MetricsController(exportMetrics);
    const reply = {
      type: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    const req = {} as FastifyRequest;

    controller.scrape(req, reply);

    expect(reply.type).toHaveBeenCalledWith('text/plain; version=0.0.4; charset=utf-8');
    expect(reply.header).toHaveBeenCalledWith('cache-control', 'no-store');
    expect(reply.send).toHaveBeenCalledWith('# HELP cache_hits_total...\ncache_hits_total 42\n');
  });
});
