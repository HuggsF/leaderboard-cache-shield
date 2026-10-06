import { InvalidScoreError } from '@domain/errors/invalid-score.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** Total points of a student across completed courses: an integer between 0 and 10,000. */
export class Score {
  static readonly MIN = 0;
  static readonly MAX = 10_000;

  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static create(raw: number): Result<Score, InvalidScoreError> {
    if (!Number.isInteger(raw)) {
      return fail(new InvalidScoreError(String(raw), 'Score must be an integer'));
    }
    if (raw < Score.MIN || raw > Score.MAX) {
      return fail(
        new InvalidScoreError(String(raw), `Score must be between ${Score.MIN} and ${Score.MAX}`),
      );
    }
    return ok(new Score(raw));
  }

  equals(other: Score): boolean {
    return this.value === other.value;
  }

  isGreaterThan(other: Score): boolean {
    return this.value > other.value;
  }
}
