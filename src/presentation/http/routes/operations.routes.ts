import type { FastifyInstance } from 'fastify';
import type { HealthController } from '@presentation/http/controllers/health.controller';
import type { MetricsController } from '@presentation/http/controllers/metrics.controller';

/** Operational endpoints: liveness/readiness and Prometheus scraping. */
export const registerOperationsRoutes = (
  app: FastifyInstance,
  controllers: { readonly health: HealthController; readonly metrics: MetricsController },
): void => {
  app.get('/health', controllers.health.check);
  app.get('/metrics', controllers.metrics.scrape);
};
