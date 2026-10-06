import type { FieldValidationError } from '@domain/errors/domain.error';
import { InvalidCompletedCoursesError } from '@domain/errors/invalid-completed-courses.error';
import { InvalidLeaderboardEntryError } from '@domain/errors/invalid-leaderboard-entry.error';
import { InvalidStudentIdError } from '@domain/errors/invalid-student-id.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { CourseName } from '@domain/value-objects/course-name.value-object';
import { Rank } from '@domain/value-objects/rank.value-object';
import { Score } from '@domain/value-objects/score.value-object';
import { StudentName } from '@domain/value-objects/student-name.value-object';

export type LeaderboardEntryProps = {
  readonly studentId: string;
  readonly studentName: string;
  /** The course in which the student earned the most points (their "top course"). */
  readonly courseName: string;
  readonly totalScore: number;
  readonly rank: number;
  readonly completedCourses: number;
};

const STUDENT_ID_MAX_LENGTH = 36;

/** One ranked student. Identity: the student id (a student appears at most once per ranking). */
export class LeaderboardEntry {
  private constructor(
    readonly studentId: string,
    readonly studentName: StudentName,
    readonly courseName: CourseName,
    readonly totalScore: Score,
    readonly rank: Rank,
    readonly completedCourses: number,
  ) {
    Object.freeze(this);
  }

  /** Validates every field and returns ALL violations at once. */
  static create(
    props: LeaderboardEntryProps,
  ): Result<LeaderboardEntry, InvalidLeaderboardEntryError> {
    const violations: FieldValidationError[] = [];
    const collect = <T>(result: Result<T, FieldValidationError>): T | null => {
      if (result.success) {
        return result.data;
      }
      violations.push(result.error);
      return null;
    };

    const studentId = collect(LeaderboardEntry.validateStudentId(props.studentId));
    const studentName = collect(StudentName.create(props.studentName));
    const courseName = collect(CourseName.create(props.courseName));
    const totalScore = collect(Score.create(props.totalScore));
    const rank = collect(Rank.create(props.rank));
    const completedCourses = collect(
      LeaderboardEntry.validateCompletedCourses(props.completedCourses),
    );

    if (
      studentId === null ||
      studentName === null ||
      courseName === null ||
      totalScore === null ||
      rank === null ||
      completedCourses === null
    ) {
      return fail(new InvalidLeaderboardEntryError(violations));
    }
    return ok(
      new LeaderboardEntry(studentId, studentName, courseName, totalScore, rank, completedCourses),
    );
  }

  equals(other: LeaderboardEntry): boolean {
    return this.studentId === other.studentId;
  }

  private static validateStudentId(raw: string): Result<string, InvalidStudentIdError> {
    const id = raw.trim();
    if (id.length === 0) {
      return fail(new InvalidStudentIdError(raw, 'Student id is required'));
    }
    if (id.length > STUDENT_ID_MAX_LENGTH) {
      return fail(
        new InvalidStudentIdError(
          raw,
          `Student id must be at most ${STUDENT_ID_MAX_LENGTH} characters`,
        ),
      );
    }
    return ok(id);
  }

  private static validateCompletedCourses(
    raw: number,
  ): Result<number, InvalidCompletedCoursesError> {
    if (!Number.isSafeInteger(raw) || raw < 0) {
      return fail(
        new InvalidCompletedCoursesError(
          String(raw),
          'Completed courses must be a non-negative integer',
        ),
      );
    }
    return ok(raw);
  }
}
