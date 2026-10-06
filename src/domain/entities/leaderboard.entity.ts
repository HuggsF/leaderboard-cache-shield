import type { LeaderboardEntry } from '@domain/entities/leaderboard-entry.entity';
import { InvalidLeaderboardError } from '@domain/errors/invalid-leaderboard.error';
import type { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { PageRequest } from '@domain/value-objects/page-request.value-object';

export type LeaderboardProps = {
  readonly entries: readonly LeaderboardEntry[];
  /** When the ranking was computed from the source of truth (MySQL). */
  readonly generatedAt: Date;
  /** Number of ranked students across all pages. */
  readonly totalStudents: number;
  readonly pageSize: number;
  readonly currentPage: number;
};

/** One page of the student ranking, as computed at `generatedAt`. */
export class Leaderboard {
  private constructor(
    readonly entries: readonly LeaderboardEntry[],
    readonly generatedAt: Date,
    readonly totalStudents: number,
    private readonly pageRequest: PageRequest,
  ) {
    Object.freeze(this);
  }

  static create(
    props: LeaderboardProps,
  ): Result<Leaderboard, InvalidLeaderboardError | InvalidPageRequestError> {
    const pageRequest = PageRequest.create(props.currentPage, props.pageSize);
    if (!pageRequest.success) {
      return pageRequest;
    }
    const violation = Leaderboard.findInvariantViolation(props, pageRequest.data);
    if (violation !== null) {
      return fail(new InvalidLeaderboardError(violation));
    }
    return ok(
      new Leaderboard(
        Object.freeze([...props.entries]),
        new Date(props.generatedAt.getTime()),
        props.totalStudents,
        pageRequest.data,
      ),
    );
  }

  get pageSize(): number {
    return this.pageRequest.pageSize;
  }

  get currentPage(): number {
    return this.pageRequest.page;
  }

  get totalPages(): number {
    return Math.ceil(this.totalStudents / this.pageSize);
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** Milliseconds elapsed since the ranking was computed (never negative). */
  ageMs(now: Date = new Date()): number {
    return Math.max(0, now.getTime() - this.generatedAt.getTime());
  }

  /** True once the ranking is older than `maxAgeMs`: it may no longer reflect the database. */
  isStale(maxAgeMs: number, now: Date = new Date()): boolean {
    return this.ageMs(now) > maxAgeMs;
  }

  private static findInvariantViolation(
    props: LeaderboardProps,
    pageRequest: PageRequest,
  ): string | null {
    if (Number.isNaN(props.generatedAt.getTime())) {
      return 'Generation date is invalid';
    }
    if (!Number.isSafeInteger(props.totalStudents) || props.totalStudents < 0) {
      return 'Total students must be a non-negative integer';
    }
    if (props.entries.length > pageRequest.pageSize) {
      return `A page holds at most ${pageRequest.pageSize} entries, got ${props.entries.length}`;
    }
    const remainingStudents = Math.max(0, props.totalStudents - pageRequest.offset);
    if (props.entries.length > remainingStudents) {
      return `Page ${pageRequest.page} cannot hold ${props.entries.length} entries when only ${remainingStudents} ranked students remain`;
    }
    return Leaderboard.findOrderingViolation(props.entries, props.totalStudents);
  }

  private static findOrderingViolation(
    entries: readonly LeaderboardEntry[],
    totalStudents: number,
  ): string | null {
    const seen = new Set<string>();
    let previous: LeaderboardEntry | undefined;
    for (const entry of entries) {
      if (seen.has(entry.studentId)) {
        return `Student ${entry.studentId} appears more than once`;
      }
      seen.add(entry.studentId);
      if (entry.rank.value > totalStudents) {
        return `Rank ${entry.rank.value} exceeds the number of ranked students (${totalStudents})`;
      }
      if (previous !== undefined) {
        if (entry.rank.isAhead(previous.rank)) {
          return 'Entries must be ordered by rank';
        }
        if (entry.totalScore.isGreaterThan(previous.totalScore)) {
          return 'A better rank can never have a lower score';
        }
      }
      previous = entry;
    }
    return null;
  }
}
