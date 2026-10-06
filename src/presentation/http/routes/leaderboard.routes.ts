import type { FastifyInstance } from 'fastify';
import type { LeaderboardController } from '@presentation/http/controllers/leaderboard.controller';
import { leaderboardResponseSchema } from '@presentation/http/schemas/leaderboard.schemas';

const routeOptions = { schema: { response: { 200: leaderboardResponseSchema } } };

export const registerLeaderboardRoutes = (
  app: FastifyInstance,
  controller: LeaderboardController,
): void => {
  app.get('/api/v1/leaderboard', routeOptions, controller.getNaive);
  app.get('/api/v2/leaderboard', routeOptions, controller.getWithLock);
  app.get('/api/v3/leaderboard', routeOptions, controller.getSwr);
};
