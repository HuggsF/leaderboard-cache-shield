import type { Leaderboard } from '@domain/entities/leaderboard.entity';

/** Port to the source of truth of the ranking (implemented with the heavy MySQL query). */
export interface LeaderboardRepository {
  /**
   * Computes one page of the ranking. Expensive by design: callers are expected to cache it.
   * Rejects when the data source is unavailable or returns data that violates the domain rules.
   */
  getLeaderboard(page: number, pageSize: number): Promise<Leaderboard>;
}
