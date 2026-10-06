import { InvalidRankError } from '@domain/errors/invalid-rank.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/**
 * Position in the ranking: a positive integer. Ties share the same rank and leave a gap
 * (SQL `RANK()` semantics: 1, 2, 2, 4).
 */
export class Rank {
  static readonly MIN = 1;

  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static create(raw: number): Result<Rank, InvalidRankError> {
    if (!Number.isSafeInteger(raw)) {
      return fail(new InvalidRankError(String(raw), 'Rank must be an integer'));
    }
    if (raw < Rank.MIN) {
      return fail(new InvalidRankError(String(raw), 'Rank must be a positive integer'));
    }
    return ok(new Rank(raw));
  }

  equals(other: Rank): boolean {
    return this.value === other.value;
  }

  isAhead(other: Rank): boolean {
    return this.value < other.value;
  }
}
