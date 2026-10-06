import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import type { HealthController } from '@presentation/http/controllers/health.controller';
import type { LeaderboardController } from '@presentation/http/controllers/leaderboard.controller';
import type { MetricsController } from '@presentation/http/controllers/metrics.controller';
import { errorHandler, notFoundHandler } from '@presentation/http/middleware/error-handler';
import { registerLeaderboardRoutes } from '@presentation/http/routes/leaderboard.routes';
import { registerOperationsRoutes } from '@presentation/http/routes/operations.routes';

export type HttpAppDependencies = {
  readonly logger: FastifyBaseLogger;
  /** Per-request access logs. Off by default: at 10k req/s they cost more than the handler. */
  readonly logRequests: boolean;
  readonly leaderboardController: LeaderboardController;
  readonly healthController: HealthController;
  readonly metricsController: MetricsController;
};

export const createHttpApp = (dependencies: HttpAppDependencies): FastifyInstance => {
  const app = Fastify({
    loggerInstance: dependencies.logger,
    disableRequestLogging: !dependencies.logRequests,
    requestIdHeader: 'x-request-id',
    genReqId: () => uuidv7(),
    // While closing: answer 503 to new requests, close idle keep-alive sockets.
    return503OnClosing: true,
    forceCloseConnections: 'idle',
  });

  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  registerLeaderboardRoutes(app, dependencies.leaderboardController);
  registerOperationsRoutes(app, {
    health: dependencies.healthController,
    metrics: dependencies.metricsController,
  });
  return app;
};
