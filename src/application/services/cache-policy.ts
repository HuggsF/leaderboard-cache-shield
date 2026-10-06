export type CachePolicy = {
  /** Entries per leaderboard page (fixed by configuration, part of the cached payload). */
  readonly pageSize: number;
  /** How long an entry is served as fresh (SPEC: 300 s). */
  readonly freshTtlSeconds: number;
  /** Total lifetime of an entry; between the two TTLs it is stale (SPEC: 600 s). */
  readonly staleTtlSeconds: number;
};

export type LockPolicy = {
  /** Lock lease: must exceed the slowest expected query (SPEC: 10 s). */
  readonly lockTtlMs: number;
  /** Upper bound for a request that waits for someone else's refresh, measured from its start. */
  readonly waitTimeoutMs: number;
  /** How often a waiting request probes the freshness marker. */
  readonly pollIntervalMs: number;
};
