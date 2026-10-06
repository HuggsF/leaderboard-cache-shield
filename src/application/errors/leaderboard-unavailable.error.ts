import { ApplicationError } from './application.error';

/**
 * Another request is rebuilding the ranking and nothing cached can be served in the meantime.
 * Answering "try again in a moment" (503 + Retry-After) is what keeps MySQL safe: the request
 * never falls through to the database on its own.
 */
export class LeaderboardUnavailableError extends ApplicationError {
  readonly code = 'LEADERBOARD_UNAVAILABLE';

  constructor(readonly waitedMs: number) {
    super(
      `The leaderboard is being rebuilt and no cached copy is available (waited ${Math.round(waitedMs)} ms)`,
    );
  }
}
