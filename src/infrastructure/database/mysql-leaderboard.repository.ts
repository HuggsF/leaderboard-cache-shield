import type { Knex } from 'knex';
import { z } from 'zod';
import type { Clock } from '@application/interfaces/clock';
import { LeaderboardEntry } from '@domain/entities/leaderboard-entry.entity';
import { Leaderboard } from '@domain/entities/leaderboard.entity';
import type { LeaderboardRepository } from '@domain/repositories/leaderboard.repository';

/**
 * The "heavy query" of the SPEC: aggregates every completed enrollment, ranks all students with
 * a window function and returns one page. Additions to the SPEC's query:
 * - `artificial_cost`: a one-row derived table (materialised once, thanks to LIMIT) calling
 *   SLEEP() to emulate a ~500 ms production query on a laptop-sized dataset. 0 in tests.
 * - `COUNT(*) OVER ()`: total ranked students in the same pass (window functions run after
 *   GROUP BY and before LIMIT).
 * - `s.id` tie-breaker: RANK() gives ties the same rank, so ordering by score alone would make
 *   LIMIT/OFFSET pagination non-deterministic (a student could appear on two pages).
 * - `top_course`: correlated subquery evaluated for the page's rows only (uses idx_student).
 * `rank` is a reserved word since MySQL 8.0.2, hence the back-ticks.
 */
export const LEADERBOARD_SQL = `
SELECT
  ranked.student_id,
  ranked.student_name,
  ranked.total_score,
  ranked.completed_courses,
  ranked.\`rank\`,
  ranked.total_students,
  (
    SELECT c.name
    FROM enrollments te
    JOIN courses c ON c.id = te.course_id
    WHERE te.student_id = ranked.student_id AND te.completed = TRUE
    ORDER BY te.score DESC, c.name ASC
    LIMIT 1
  ) AS top_course
FROM (
  SELECT
    s.id AS student_id,
    s.name AS student_name,
    SUM(e.score) AS total_score,
    COUNT(e.course_id) AS completed_courses,
    RANK() OVER (ORDER BY SUM(e.score) DESC) AS \`rank\`,
    COUNT(*) OVER () AS total_students
  FROM students s
  JOIN enrollments e ON s.id = e.student_id
  CROSS JOIN (SELECT SLEEP(?) AS slept LIMIT 1) AS artificial_cost
  WHERE e.completed = TRUE
  GROUP BY s.id
  ORDER BY total_score DESC, s.id ASC
  LIMIT ? OFFSET ?
) AS ranked
ORDER BY ranked.\`rank\` ASC, ranked.student_id ASC`;

const RANKED_STUDENTS_SQL =
  'SELECT COUNT(DISTINCT student_id) AS total FROM enrollments WHERE completed = TRUE';

const rankingRowSchema = z.object({
  student_id: z.string(),
  student_name: z.string(),
  total_score: z.number(),
  completed_courses: z.number(),
  rank: z.number(),
  total_students: z.number(),
  top_course: z.string().nullable(),
});

const countRowSchema = z.object({ total: z.number() });

export type MySqlLeaderboardRepositoryOptions = {
  /** Artificial cost added to every ranking query (SLEEP), in milliseconds. */
  readonly queryDelayMs: number;
};

/** Raised when MySQL returns rows that violate the domain rules (e.g. a score above 10,000). */
export class LeaderboardDataIntegrityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LeaderboardDataIntegrityError';
  }
}

/** mysql2 resolves `knex.raw` with `[rows, fields]`. */
const rowsOf = (result: unknown): unknown => (Array.isArray(result) ? result[0] : undefined);

export class MySqlLeaderboardRepository implements LeaderboardRepository {
  constructor(
    private readonly db: Knex,
    private readonly clock: Pick<Clock, 'now'>,
    private readonly options: MySqlLeaderboardRepositoryOptions,
  ) {}

  async getLeaderboard(page: number, pageSize: number): Promise<Leaderboard> {
    const offset = (page - 1) * pageSize;
    const result: unknown = await this.db.raw(LEADERBOARD_SQL, [
      this.options.queryDelayMs / 1000,
      pageSize,
      offset,
    ]);
    const rows = z.array(rankingRowSchema).parse(rowsOf(result));
    const generatedAt = this.clock.now();
    const totalStudents = rows[0]?.total_students ?? (await this.countRankedStudents());

    const entries = rows.map((row) => {
      const entry = LeaderboardEntry.create({
        studentId: row.student_id,
        studentName: row.student_name,
        courseName: row.top_course ?? '',
        totalScore: row.total_score,
        rank: row.rank,
        completedCourses: row.completed_courses,
      });
      if (!entry.success) {
        throw new LeaderboardDataIntegrityError(entry.error.message, { cause: entry.error });
      }
      return entry.data;
    });

    const leaderboard = Leaderboard.create({
      entries,
      generatedAt,
      totalStudents,
      pageSize,
      currentPage: page,
    });
    if (!leaderboard.success) {
      throw new LeaderboardDataIntegrityError(leaderboard.error.message, {
        cause: leaderboard.error,
      });
    }
    return leaderboard.data;
  }

  /** Only needed for a page past the end, where the window function has no row to report on. */
  private async countRankedStudents(): Promise<number> {
    const result: unknown = await this.db.raw(RANKED_STUDENTS_SQL);
    const [row] = z.array(countRowSchema).parse(rowsOf(result));
    return row?.total ?? 0;
  }
}
