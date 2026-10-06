import { DomainError } from './domain.error';
import type { FieldValidationError } from './domain.error';

/** A ranking row violates one or more invariants; every violation is reported at once. */
export class InvalidLeaderboardEntryError extends DomainError {
  readonly code = 'INVALID_LEADERBOARD_ENTRY';

  constructor(readonly violations: readonly FieldValidationError[]) {
    super(
      `Invalid leaderboard entry: ${violations.map((violation) => `${violation.field}: ${violation.message}`).join('; ')}`,
    );
  }
}
