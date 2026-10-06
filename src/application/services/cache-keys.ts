/** Each strategy has its own namespace so the three endpoints never read each other's entries. */
export type CacheNamespace = 'v1' | 'v2' | 'v3';

export type LeaderboardCacheKeys = {
  /** Logical entry: stored at `{entry}:data`, with the SWR freshness marker at `{entry}:stale`. */
  readonly entry: string;
  /** Redlock resource that serialises the rebuild of this page. */
  readonly lock: string;
};

/** `leaderboard:{namespace}:page:{n}` + `:data` / `:stale` / `:lock`. */
export const leaderboardCacheKeys = (
  namespace: CacheNamespace,
  page: number,
): LeaderboardCacheKeys => {
  const entry = `leaderboard:${namespace}:page:${page}`;
  return { entry, lock: `${entry}:lock` };
};
