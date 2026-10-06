import type { Redis } from 'ioredis';
import Redlock, { ExecutionError, ResourceLockedError } from 'redlock';
import type { Lock } from 'redlock';
import type { DistributedLock, LockAcquireOptions } from '@application/interfaces/distributed-lock';

export type RedlockOptions = {
  readonly retryCount: number;
  readonly retryDelayMs: number;
  readonly retryJitterMs: number;
};

/**
 * Redlock over a single Redis node (quorum = 1). For this use case the lock is an EFFICIENCY
 * lock — it prevents duplicate work; correctness never depends on it because rebuilding the
 * cache entry is idempotent. See docs/adr/002-distributed-lock-algorithm.md.
 */
export const createRedlock = (client: Redis, options: RedlockOptions): Redlock =>
  new Redlock([client], {
    driftFactor: 0.01,
    retryCount: options.retryCount,
    retryDelay: options.retryDelayMs,
    retryJitter: options.retryJitterMs,
    automaticExtensionThreshold: 500,
  });

/**
 * True when every failed vote of every attempt was "resource already locked", i.e. someone else
 * holds the lock. Any other vote error (connection refused, timeout…) is an infrastructure
 * failure and must surface instead of being mistaken for contention.
 */
const isLockContention = async (error: unknown): Promise<boolean> => {
  if (!(error instanceof ExecutionError) || error.attempts.length === 0) {
    return false;
  }
  const attempts = await Promise.all(error.attempts);
  return attempts.every((stats) => {
    const votes = [...stats.votesAgainst.values()];
    return votes.length > 0 && votes.every((vote) => vote instanceof ResourceLockedError);
  });
};

export class RedlockDistributedLock implements DistributedLock {
  /** Locks acquired by this process, by id — `release(key, lockId)` needs the Lock object. */
  private readonly held = new Map<string, Lock>();

  constructor(private readonly redlock: Redlock) {}

  async acquire(
    key: string,
    ttlMs: number,
    options: LockAcquireOptions = {},
  ): Promise<string | null> {
    try {
      const lock = await this.redlock.acquire(
        [key],
        Math.ceil(ttlMs),
        options.retryCount === undefined ? undefined : { retryCount: options.retryCount },
      );
      this.held.set(lock.value, lock);
      return lock.value;
    } catch (error: unknown) {
      if (await isLockContention(error)) {
        return null;
      }
      throw error;
    }
  }

  async release(key: string, lockId: string): Promise<boolean> {
    const lock = this.held.get(lockId);
    if (!lock?.resources.includes(key)) {
      return false;
    }
    this.held.delete(lockId);
    try {
      // No retries: if the lease expired (or was taken over) retrying cannot help.
      await this.redlock.release(lock, { retryCount: 0 });
      return true;
    } catch (error: unknown) {
      if (await isLockContention(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Locks acquired and not yet released by this process (diagnostics, tests). */
  get heldLocks(): number {
    return this.held.size;
  }
}
