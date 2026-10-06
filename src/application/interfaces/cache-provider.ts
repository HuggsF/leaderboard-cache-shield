export type CachedValue<T> = {
  /** `null` when nothing is cached under the key (never cached, or past its stale TTL). */
  readonly data: T | null;
  /** True when the value is past its fresh TTL but still within its stale TTL. */
  readonly isStale: boolean;
};

/**
 * Cache port. A logical entry `K` is stored by the adapter at `K:data`; entries written with
 * stale support also carry a freshness marker at `K:stale` whose expiry turns the data stale.
 * Generic over the cached value so a cache instance is bound to one payload type.
 */
export interface CacheProvider<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlSeconds: number): Promise<void>;
  getWithStaleSupport(key: string): Promise<CachedValue<T>>;
  /**
   * Stores `value` fresh for `freshTtlSeconds`, then stale until `staleTtlSeconds` (total
   * lifetime, greater than the fresh TTL) after which it disappears.
   */
  setWithStaleSupport(
    key: string,
    value: T,
    freshTtlSeconds: number,
    staleTtlSeconds: number,
  ): Promise<void>;
  /** Cheap freshness probe (no payload transferred), used while waiting for another refresh. */
  isFresh(key: string): Promise<boolean>;
}
