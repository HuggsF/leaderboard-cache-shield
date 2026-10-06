import { DomainError } from './domain.error';

/** A leaderboard page is internally inconsistent (ordering, size, totals). */
export class InvalidLeaderboardError extends DomainError {
  readonly code = 'INVALID_LEADERBOARD';

  constructor(reason: string) {
    super(`Invalid leaderboard: ${reason}`);
  }
}
