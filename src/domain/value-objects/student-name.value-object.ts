import { InvalidStudentNameError } from '@domain/errors/invalid-student-name.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { characterLength, normalizeWhitespace } from '@domain/shared/text';

export class StudentName {
  static readonly MIN_LENGTH = 2;
  static readonly MAX_LENGTH = 100;

  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  /** Trims the name and collapses inner whitespace before validating its length. */
  static create(raw: string): Result<StudentName, InvalidStudentNameError> {
    const normalized = normalizeWhitespace(raw);
    const length = characterLength(normalized);

    if (length === 0) {
      return fail(new InvalidStudentNameError(raw, 'Student name is required'));
    }
    if (length < StudentName.MIN_LENGTH || length > StudentName.MAX_LENGTH) {
      return fail(
        new InvalidStudentNameError(
          raw,
          `Student name must be between ${StudentName.MIN_LENGTH} and ${StudentName.MAX_LENGTH} characters`,
        ),
      );
    }
    return ok(new StudentName(normalized));
  }

  equals(other: StudentName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
