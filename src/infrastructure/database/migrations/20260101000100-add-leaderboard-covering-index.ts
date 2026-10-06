import type { Knex } from 'knex';

export const name = '20260101000100_add_leaderboard_covering_index';

/**
 * Covering index for the ranking aggregation: `WHERE completed = TRUE GROUP BY student_id`
 * with `SUM(score)` / `COUNT(course_id)` is answered from the index alone, already grouped by
 * student, without touching the clustered rows. The ranking still needs a full aggregation +
 * sort of every ranked student — which is why it is cached, not "fixed" by the index.
 */
export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(
    'CREATE INDEX idx_leaderboard_covering ON enrollments (completed, student_id, score, course_id)',
  );
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX idx_leaderboard_covering ON enrollments');
};
