import type { GetLeaderboardOutput, LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { CacheProvider } from '@application/interfaces/cache-provider';
import type { Clock } from '@application/interfaces/clock';
import type { DistributedLock } from '@application/interfaces/distributed-lock';
import type { Logger } from '@application/interfaces/logger';
import type { MetricsCollector } from '@application/interfaces/metrics-collector';
import type { PageRequest } from '@domain/value-objects/page-request.value-object';
import type { LeaderboardCacheKeys } from './cache-keys';
import type { CachePolicy, LockPolicy } from './cache-policy';
import type { LeaderboardLoader } from './leaderboard-loader';

export type RefreshOutcome = GetLeaderboardOutput & {
  readonly cacheStatus: 'MISS' | 'COALESCED';
};

/**
 * Rebuilds a cache entry under a distributed lock, so that across every instance at most one
 * request queries MySQL for a given page at a time. Shared by the lock (v2) and SWR (v3)
 * strategies.
 */
export class LockGuardedRefresher {
  constructor(
    private readonly cache: CacheProvider<LeaderboardDTO>,
    private readonly lock: DistributedLock,
    private readonly loader: LeaderboardLoader,
    private readonly clock: Clock,
    private readonly metrics: MetricsCollector,
    private readonly logger: Logger,
    private readonly cachePolicy: CachePolicy,
    private readonly lockPolicy: LockPolicy,
  ) {}

  /**
   * Foreground rebuild: the lock winner queries MySQL; every loser waits (bounded by
   * `deadlineMs`) for the winner's result instead of querying too. `null` = gave up waiting.
   */
  async refreshOrWait(
    keys: LeaderboardCacheKeys,
    pageRequest: PageRequest,
    deadlineMs: number,
  ): Promise<RefreshOutcome | null> {
    const lockId = await this.lock.acquire(keys.lock, this.lockPolicy.lockTtlMs);
    if (lockId !== null) {
      return this.refreshHoldingLock(keys, pageRequest, lockId);
    }
    this.metrics.incrementLockWait();
    const leaderboard = await this.waitForFreshEntry(keys.entry, deadlineMs);
    return leaderboard === null ? null : { leaderboard, cacheStatus: 'COALESCED' };
  }

  /**
   * Background rebuild (SWR): tries the lock exactly once — if it is taken, someone is already
   * refreshing this page. Never rejects: failures are logged and stale data keeps being served.
   */
  async revalidate(keys: LeaderboardCacheKeys, pageRequest: PageRequest): Promise<void> {
    try {
      const lockId = await this.lock.acquire(keys.lock, this.lockPolicy.lockTtlMs, {
        retryCount: 0,
      });
      if (lockId === null) {
        return;
      }
      const outcome = await this.refreshHoldingLock(keys, pageRequest, lockId);
      this.logger.debug(
        { key: keys.entry, cacheStatus: outcome.cacheStatus },
        'Background revalidation finished',
      );
    } catch (error: unknown) {
      this.logger.error(
        { err: error, key: keys.entry },
        'Background revalidation failed; the stale entry keeps being served',
      );
    }
  }

  private async refreshHoldingLock(
    keys: LeaderboardCacheKeys,
    pageRequest: PageRequest,
    lockId: string,
  ): Promise<RefreshOutcome> {
    try {
      // Double-checked locking: the previous holder may have rebuilt the entry between our
      // cache read and our lock acquisition — querying again would be a wasted query.
      const current = await this.cache.getWithStaleSupport(keys.entry);
      if (current.data !== null && !current.isStale) {
        return { leaderboard: current.data, cacheStatus: 'COALESCED' };
      }
      const leaderboard = await this.loader.load(pageRequest);
      await this.store(keys.entry, leaderboard);
      return { leaderboard, cacheStatus: 'MISS' };
    } finally {
      await this.releaseQuietly(keys.lock, lockId);
    }
  }

  private async store(key: string, leaderboard: LeaderboardDTO): Promise<void> {
    try {
      await this.cache.setWithStaleSupport(
        key,
        leaderboard,
        this.cachePolicy.freshTtlSeconds,
        this.cachePolicy.staleTtlSeconds,
      );
    } catch (error: unknown) {
      // The data is valid: answer the request anyway, the next request will retry the write.
      this.logger.warn({ err: error, key }, 'Could not write the leaderboard to the cache');
    }
  }

  private async releaseQuietly(lockKey: string, lockId: string): Promise<void> {
    try {
      const released = await this.lock.release(lockKey, lockId);
      if (!released) {
        this.logger.warn(
          { lockKey, lockTtlMs: this.lockPolicy.lockTtlMs },
          'Lock expired before release: the refresh took longer than the lock TTL',
        );
      }
    } catch (error: unknown) {
      this.logger.warn({ err: error, lockKey }, 'Could not release the lock; it will expire');
    }
  }

  /** Polls the cheap freshness marker; downloads the payload only once it is fresh. */
  private async waitForFreshEntry(key: string, deadlineMs: number): Promise<LeaderboardDTO | null> {
    for (;;) {
      const remainingMs = deadlineMs - this.clock.nowMs();
      if (remainingMs <= 0) {
        return null;
      }
      await this.clock.sleep(Math.min(this.lockPolicy.pollIntervalMs, remainingMs));
      if (await this.cache.isFresh(key)) {
        const entry = await this.cache.getWithStaleSupport(key);
        if (entry.data !== null) {
          return entry.data;
        }
      }
    }
  }
}
