import { InvalidCourseNameError } from '@domain/errors/invalid-course-name.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { characterLength, normalizeWhitespace } from '@domain/shared/text';

export class CourseName {
  static readonly MIN_LENGTH = 2;
  static readonly MAX_LENGTH = 200;

  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  /** Trims the name and collapses inner whitespace before validating its length. */
  static create(raw: string): Result<CourseName, InvalidCourseNameError> {
    const normalized = normalizeWhitespace(raw);
    const length = characterLength(normalized);

    if (length === 0) {
      return fail(new InvalidCourseNameError(raw, 'Course name is required'));
    }
    if (length < CourseName.MIN_LENGTH || length > CourseName.MAX_LENGTH) {
      return fail(
        new InvalidCourseNameError(
          raw,
          `Course name must be between ${CourseName.MIN_LENGTH} and ${CourseName.MAX_LENGTH} characters`,
        ),
      );
    }
    return ok(new CourseName(normalized));
  }

  equals(other: CourseName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
