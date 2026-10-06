import type { GetLeaderboardInput, LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import { LeaderboardUnavailableError } from '@application/errors/leaderboard-unavailable.error';
import type { CacheProvider } from '@application/interfaces/cache-provider';
import type { Clock } from '@application/interfaces/clock';
import type { MetricsCollector } from '@application/interfaces/metrics-collector';
import { leaderboardCacheKeys } from '@application/services/cache-keys';
import type { CachePolicy, LockPolicy } from '@application/services/cache-policy';
import { executeLeaderboardQuery } from '@application/services/leaderboard-query';
import type { GetLeaderboardResult } from '@application/services/leaderboard-query';
import type { LockGuardedRefresher } from '@application/services/lock-guarded-refresher';
import { fail, ok } from '@domain/shared/result';

/**
 * v2 — distributed lock. On a miss only the lock winner queries MySQL; the other requests
 * wait (bounded) for its result, then fall back to the stale copy, then to a 503.
 * Protects the database, but the requests that arrive during the rebuild pay its latency.
 */
export class GetLeaderboardWithLockUseCase {
  constructor(
    private readonly cache: CacheProvider<LeaderboardDTO>,
    private readonly refresher: LockGuardedRefresher,
    private readonly clock: Pick<Clock, 'nowMs'>,
    private readonly metrics: MetricsCollector,
    private readonly policy: Pick<CachePolicy, 'pageSize'> & Pick<LockPolicy, 'waitTimeoutMs'>,
  ) {}

  execute(input: GetLeaderboardInput): Promise<GetLeaderboardResult> {
    const context = {
      operation: 'GetLeaderboardWithLock',
      pageSize: this.policy.pageSize,
      clock: this.clock,
      metrics: this.metrics,
    };
    return executeLeaderboardQuery(input, context, async (pageRequest, startedAtMs) => {
      const keys = leaderboardCacheKeys('v2', pageRequest.page);

      // 1. Check Redis  2. Fresh hit → return
      const cached = await this.cache.getWithStaleSupport(keys.entry);
      if (cached.data !== null && !cached.isStale) {
        this.metrics.incrementCacheHit();
        return ok({ leaderboard: cached.data, cacheStatus: 'HIT' });
      }

      // 3-4. Miss (or stale) → the lock winner rebuilds; losers wait for its result
      this.metrics.incrementCacheMiss();
      const deadlineMs = startedAtMs + this.policy.waitTimeoutMs;
      const outcome = await this.refresher.refreshOrWait(keys, pageRequest, deadlineMs);
      if (outcome !== null) {
        return ok(outcome);
      }

      // 5. Waited long enough → serve the stale copy if there is one, never query MySQL
      if (cached.data !== null) {
        this.metrics.incrementStaleServed();
        return ok({ leaderboard: cached.data, cacheStatus: 'STALE' });
      }
      return fail(new LeaderboardUnavailableError(this.clock.nowMs() - startedAtMs));
    });
  }
}
