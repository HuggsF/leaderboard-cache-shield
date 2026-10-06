/** `response`: whole use case (cache + waits + query); `db_query`: the heavy MySQL query only. */
export type LatencyLabel = 'response' | 'db_query';

export type LatencySummary = {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
};

export type MetricsSnapshot = {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly staleServed: number;
  readonly lockWaits: number;
  readonly dbQueries: number;
  readonly dbQueryErrors: number;
  /** Durations in milliseconds over a sliding window of recent samples. */
  readonly latency: Readonly<Record<LatencyLabel, LatencySummary>>;
};

/**
 * Metrics port. Each strategy receives its own collector, so the use cases stay unaware of
 * labels: the adapter tags every sample with the strategy it was scoped to.
 */
export interface MetricsCollector {
  /** The request was answered from Redis (fresh or stale entry) on its first lookup. */
  incrementCacheHit(): void;
  /** The first lookup found no usable entry. */
  incrementCacheMiss(): void;
  /** A stale entry was returned to the client (SWR, or the lock strategy's fallback). */
  incrementStaleServed(): void;
  /** The request lost the lock race and waited for another holder's refresh. */
  incrementLockWait(): void;
  /** One heavy query was sent to MySQL. */
  incrementDbQuery(): void;
  incrementDbQueryError(): void;
  recordLatency(label: LatencyLabel, durationMs: number): void;
  getMetrics(): MetricsSnapshot;
}
