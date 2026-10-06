import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GetLeaderboardInput, LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { GetLeaderboardResult } from '@application/services/leaderboard-query';
import { toHttpError } from '@presentation/http/errors/error-mapper';
import { HttpError } from '@presentation/http/errors/http-error';
import { leaderboardQuerySchema } from '@presentation/http/schemas/leaderboard.schemas';

export type LeaderboardQueryUseCase = {
  execute(input: GetLeaderboardInput): Promise<GetLeaderboardResult>;
};

export type LeaderboardStrategy = 'naive' | 'lock' | 'swr';

export type LeaderboardUseCases = Readonly<Record<LeaderboardStrategy, LeaderboardQueryUseCase>>;

/** GET /api/v{1,2,3}/leaderboard — same contract, three caching strategies. */
export class LeaderboardController {
  constructor(private readonly useCases: LeaderboardUseCases) {}

  getNaive = (request: FastifyRequest, reply: FastifyReply): Promise<LeaderboardDTO> =>
    this.handle('naive', request, reply);

  getWithLock = (request: FastifyRequest, reply: FastifyReply): Promise<LeaderboardDTO> =>
    this.handle('lock', request, reply);

  getSwr = (request: FastifyRequest, reply: FastifyReply): Promise<LeaderboardDTO> =>
    this.handle('swr', request, reply);

  private async handle(
    strategy: LeaderboardStrategy,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<LeaderboardDTO> {
    const query = leaderboardQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Invalid query string',
        query.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    const result = await this.useCases[strategy].execute({ page: query.data.page });
    if (!result.success) {
      throw toHttpError(result.error);
    }
    void reply.headers({
      'x-cache': result.data.cacheStatus,
      'x-cache-strategy': strategy,
      'cache-control': 'no-store',
    });
    return result.data.leaderboard;
  }
}
