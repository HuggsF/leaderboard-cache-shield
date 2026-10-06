import type { GetLeaderboardInput, LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import { LeaderboardUnavailableError } from '@application/errors/leaderboard-unavailable.error';
import type { CacheProvider } from '@application/interfaces/cache-provider';
import type { Clock } from '@application/interfaces/clock';
import type { MetricsCollector } from '@application/interfaces/metrics-collector';
import { leaderboardCacheKeys } from '@application/services/cache-keys';
import type { LeaderboardCacheKeys } from '@application/services/cache-keys';
import type { CachePolicy, LockPolicy } from '@application/services/cache-policy';
import { executeLeaderboardQuery } from '@application/services/leaderboard-query';
import type { GetLeaderboardResult } from '@application/services/leaderboard-query';
import type {
  LockGuardedRefresher,
  RefreshOutcome,
} from '@application/services/lock-guarded-refresher';
import type { SingleFlight } from '@application/services/single-flight';
import { fail, ok } from '@domain/shared/result';
import type { PageRequest } from '@domain/value-objects/page-request.value-object';

/**
 * v3 — stale-while-revalidate. A stale entry is returned immediately and ONE background
 * refresh is started (single-flight in this process, Redlock across instances): nobody waits
 * for MySQL. Only a completely cold cache makes requests wait, and even then a single query
 * runs (coalesced in-process, lock-guarded across instances).
 */
export class GetLeaderboardSWRUseCase {
  constructor(
    private readonly cache: CacheProvider<LeaderboardDTO>,
    private readonly refresher: LockGuardedRefresher,
    private readonly revalidations: SingleFlight<void>,
    private readonly coldLoads: SingleFlight<RefreshOutcome | null>,
    private readonly clock: Pick<Clock, 'nowMs'>,
    private readonly metrics: MetricsCollector,
    private readonly policy: Pick<CachePolicy, 'pageSize'> & Pick<LockPolicy, 'waitTimeoutMs'>,
  ) {}

  execute(input: GetLeaderboardInput): Promise<GetLeaderboardResult> {
    const context = {
      operation: 'GetLeaderboardSWR',
      pageSize: this.policy.pageSize,
      clock: this.clock,
      metrics: this.metrics,
    };
    return executeLeaderboardQuery(input, context, async (pageRequest, startedAtMs) => {
      const keys = leaderboardCacheKeys('v3', pageRequest.page);

      // 1. Check Redis with stale support
      const cached = await this.cache.getWithStaleSupport(keys.entry);
      if (cached.data !== null) {
        this.metrics.incrementCacheHit();
        // 2. Fresh → return immediately
        if (!cached.isStale) {
          return ok({ leaderboard: cached.data, cacheStatus: 'HIT' });
        }
        // 3. Stale → return immediately + ONE asynchronous refresh
        this.metrics.incrementStaleServed();
        this.revalidateInBackground(keys, pageRequest);
        return ok({ leaderboard: cached.data, cacheStatus: 'STALE' });
      }

      // 4. Nothing at all (cold start / evicted) → one coalesced, lock-guarded query
      this.metrics.incrementCacheMiss();
      const deadlineMs = startedAtMs + this.policy.waitTimeoutMs;
      const flight = this.coldLoads.run(keys.entry, () =>
        this.refresher.refreshOrWait(keys, pageRequest, deadlineMs),
      );
      const outcome = await flight.promise;
      if (outcome === null) {
        return fail(new LeaderboardUnavailableError(this.clock.nowMs() - startedAtMs));
      }
      return ok(flight.shared ? { ...outcome, cacheStatus: 'COALESCED' } : outcome);
    });
  }

  private revalidateInBackground(keys: LeaderboardCacheKeys, pageRequest: PageRequest): void {
    // Fire-and-forget: `revalidate` never rejects; the flight is tracked for graceful shutdown.
    void this.revalidations.run(keys.entry, () => this.refresher.revalidate(keys, pageRequest))
      .promise;
  }
}
