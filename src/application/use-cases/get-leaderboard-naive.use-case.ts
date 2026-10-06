import type { GetLeaderboardInput, LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { CacheProvider } from '@application/interfaces/cache-provider';
import type { Clock } from '@application/interfaces/clock';
import type { Logger } from '@application/interfaces/logger';
import type { MetricsCollector } from '@application/interfaces/metrics-collector';
import { leaderboardCacheKeys } from '@application/services/cache-keys';
import type { CachePolicy } from '@application/services/cache-policy';
import type { LeaderboardLoader } from '@application/services/leaderboard-loader';
import { executeLeaderboardQuery } from '@application/services/leaderboard-query';
import type { GetLeaderboardResult } from '@application/services/leaderboard-query';
import { ok } from '@domain/shared/result';

/**
 * v1 — plain cache-aside with a TTL. Kept on purpose to DEMONSTRATE the stampede: when the
 * entry expires, every concurrent request sees the miss and runs the heavy query itself.
 */
export class GetLeaderboardNaiveUseCase {
  constructor(
    private readonly cache: CacheProvider<LeaderboardDTO>,
    private readonly loader: LeaderboardLoader,
    private readonly clock: Pick<Clock, 'nowMs'>,
    private readonly metrics: MetricsCollector,
    private readonly logger: Logger,
    private readonly policy: Pick<CachePolicy, 'pageSize' | 'freshTtlSeconds'>,
  ) {}

  execute(input: GetLeaderboardInput): Promise<GetLeaderboardResult> {
    const context = {
      operation: 'GetLeaderboardNaive',
      pageSize: this.policy.pageSize,
      clock: this.clock,
      metrics: this.metrics,
    };
    return executeLeaderboardQuery(input, context, async (pageRequest) => {
      const { entry } = leaderboardCacheKeys('v1', pageRequest.page);

      // 1. Check Redis  2. Hit → return
      const cached = await this.cache.get(entry);
      if (cached !== null) {
        this.metrics.incrementCacheHit();
        return ok({ leaderboard: cached, cacheStatus: 'HIT' });
      }

      // 3. Miss → query MySQL → cache with TTL → return. Nothing stops 10,000 requests from
      //    reaching this line at the same time.
      this.metrics.incrementCacheMiss();
      const leaderboard = await this.loader.load(pageRequest);
      try {
        await this.cache.set(entry, leaderboard, this.policy.freshTtlSeconds);
      } catch (error: unknown) {
        this.logger.warn(
          { err: error, key: entry },
          'Could not write the leaderboard to the cache',
        );
      }
      return ok({ leaderboard, cacheStatus: 'MISS' });
    });
  }
}
