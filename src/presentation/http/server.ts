import type { FastifyInstance } from 'fastify';
import type { Container } from '@infrastructure/config/container';
import { createHttpApp } from '@presentation/http/app';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { LeaderboardController } from '@presentation/http/controllers/leaderboard.controller';
import { MetricsController } from '@presentation/http/controllers/metrics.controller';

/** Wires controllers to the use cases exposed by the container. */
export const buildHttpApp = (container: Container): FastifyInstance =>
  createHttpApp({
    logger: container.logger,
    logRequests: container.config.log.requests,
    leaderboardController: new LeaderboardController({
      naive: container.getLeaderboardNaive,
      lock: container.getLeaderboardWithLock,
      swr: container.getLeaderboardSWR,
    }),
    healthController: new HealthController(container.checkHealth),
    metricsController: new MetricsController(container.exportMetrics),
  });

export const listen = async (app: FastifyInstance, container: Container): Promise<string> =>
  app.listen({
    host: container.config.http.host,
    port: container.config.http.port,
    backlog: container.config.http.backlog,
  });
