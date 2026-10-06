import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';

/** Turns cached values into Redis strings and back. `decode` returns `null` for foreign data. */
export type CacheCodec<T> = {
  encode(value: T): string;
  decode(raw: string): T | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Cheap structural check (top-level fields only, O(1)): it runs on every cache hit, up to
 * thousands of times per second. Rejects entries written by an older/incompatible version
 * so they are treated as misses instead of being served.
 */
const isLeaderboardDto = (value: unknown): value is LeaderboardDTO =>
  isRecord(value) &&
  typeof value.page === 'number' &&
  typeof value.pageSize === 'number' &&
  typeof value.totalStudents === 'number' &&
  typeof value.totalPages === 'number' &&
  typeof value.generatedAt === 'string' &&
  Array.isArray(value.entries);

export const leaderboardCodec: CacheCodec<LeaderboardDTO> = {
  encode: (value) => JSON.stringify(value),
  decode: (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isLeaderboardDto(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
};
