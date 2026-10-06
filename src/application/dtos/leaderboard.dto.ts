export type LeaderboardEntryDTO = {
  readonly rank: number;
  readonly studentId: string;
  readonly studentName: string;
  /** The course in which the student earned the most points. */
  readonly courseName: string;
  readonly totalScore: number;
  readonly completedCourses: number;
};

/** JSON-safe page of the ranking: what is cached in Redis and returned over HTTP. */
export type LeaderboardDTO = {
  readonly page: number;
  readonly pageSize: number;
  readonly totalStudents: number;
  readonly totalPages: number;
  /** ISO-8601 timestamp of the MySQL query that produced this page. */
  readonly generatedAt: string;
  readonly entries: readonly LeaderboardEntryDTO[];
};

export type GetLeaderboardInput = {
  readonly page: number;
};

/**
 * - `HIT`: fresh entry found in Redis
 * - `STALE`: expired-but-kept entry returned (SWR, or the lock strategy's fallback)
 * - `MISS`: this request ran the MySQL query
 * - `COALESCED`: this request waited for another request's query (lock or single-flight)
 */
export type CacheStatus = 'HIT' | 'STALE' | 'MISS' | 'COALESCED';

export type GetLeaderboardOutput = {
  readonly leaderboard: LeaderboardDTO;
  readonly cacheStatus: CacheStatus;
};
