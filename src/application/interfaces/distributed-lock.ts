export type LockAcquireOptions = {
  /**
   * Overrides the adapter's retry policy for this call. `0` = try once and give up immediately
   * (used by background revalidation: if someone holds the lock, they are already refreshing).
   */
  readonly retryCount?: number;
};

/** Mutual exclusion across every instance of the service (implemented with Redlock). */
export interface DistributedLock {
  /** Resolves with a lock id when acquired, `null` when another holder keeps it. */
  acquire(key: string, ttlMs: number, options?: LockAcquireOptions): Promise<string | null>;
  /** Resolves `false` when the lock was no longer ours (expired, or never acquired here). */
  release(key: string, lockId: string): Promise<boolean>;
}
