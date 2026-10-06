import type { Knex } from 'knex';

export const name = '20260101000000_create_leaderboard_schema';

/** The schema of the project's CLAUDE.md, verbatim (raw DDL keeps it reviewable side by side). */
export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE TABLE students (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  await knex.raw(`
    CREATE TABLE courses (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(200) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  await knex.raw(`
    CREATE TABLE enrollments (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      course_id VARCHAR(36) NOT NULL,
      score INT NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMP NULL,
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (course_id) REFERENCES courses(id),
      INDEX idx_student (student_id),
      INDEX idx_completed (completed)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('enrollments');
  await knex.schema.dropTableIfExists('courses');
  await knex.schema.dropTableIfExists('students');
};
