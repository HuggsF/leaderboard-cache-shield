import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { loadConfig, loadEnvFile } from '../src/infrastructure/config/env';
import { createDatabase } from '../src/infrastructure/database/knex';
import { createLogger } from '../src/infrastructure/logging/logger';

loadEnvFile();

const config = loadConfig();
const logger = createLogger({
  level: config.log.level,
  pretty: true,
  name: 'seed-script',
});

const STUDENTS_COUNT = Number(process.env.SEED_STUDENTS_COUNT ?? 100_000);
const ENROLLMENTS_COUNT = Number(process.env.SEED_ENROLLMENTS_COUNT ?? 500_000);
const BATCH_SIZE = 1_000;

const COURSES = [
  'Advanced Node.js Architecture',
  'Distributed Caching & Redis Patterns',
  'Domain-Driven Design in Practice',
  'High-Performance MySQL & Query Optimization',
  'Microservices & Event-Driven Systems',
  'Clean Architecture & SOLID Principles',
  'Concurrency & Race Condition Mitigation',
  'System Design for Massive Scale',
  'Pragmatic Functional Programming in TypeScript',
  'Site Reliability Engineering & Observability',
  'Cloud-Native Kubernetes & Docker',
  'Database Indexing & Window Functions',
  'API Security & OAuth2 Best Practices',
  'Enterprise Integration Patterns',
  'Asynchronous Messaging with RabbitMQ & Kafka',
];

type StudentRecord = {
  id: string;
  name: string;
  created_at: Date;
};

type CourseRecord = {
  id: string;
  name: string;
};

type EnrollmentRecord = {
  id: string;
  student_id: string;
  course_id: string;
  score: number;
  completed: boolean;
  completed_at: Date | null;
};

export const seed = async (): Promise<void> => {
  const { faker } = await import('@faker-js/faker');
  const db = createDatabase(config.database);

  try {
    logger.info(
      { students: STUDENTS_COUNT, enrollments: ENROLLMENTS_COUNT },
      'Starting database seed',
    );

    // 1. Seed courses
    const existingCourses = await db<CourseRecord>('courses').select('id', 'name');
    const courseRecords: CourseRecord[] =
      existingCourses.length >= COURSES.length
        ? existingCourses
        : COURSES.map((name) => ({ id: uuidv4(), name }));

    if (existingCourses.length < COURSES.length) {
      await db('courses').del();
      await db.batchInsert('courses', courseRecords, 50);
      logger.info({ count: courseRecords.length }, 'Inserted courses');
    }

    const courseIds = courseRecords.map((c) => c.id);

    // 2. Check if students are already seeded
    const countResult: unknown = await db('students').count('id as currentStudents');
    const countSchema = z.array(z.object({ currentStudents: z.coerce.number() }));
    const parsedCount = countSchema.safeParse(countResult);
    const currentStudents = parsedCount.success ? (parsedCount.data[0]?.currentStudents ?? 0) : 0;
    let studentIds: string[] = [];

    if (currentStudents >= STUDENTS_COUNT) {
      logger.info({ currentStudents }, 'Students already seeded. Skipping student insertion.');
      const existing = await db<StudentRecord>('students').select('id');
      studentIds = existing.map((s) => s.id);
    } else {
      logger.info({ target: STUDENTS_COUNT }, 'Seeding students in batches...');

      for (let i = 0; i < STUDENTS_COUNT; i += BATCH_SIZE) {
        const batchSize = Math.min(BATCH_SIZE, STUDENTS_COUNT - i);
        const studentBatch: StudentRecord[] = [];

        for (let j = 0; j < batchSize; j += 1) {
          const id = uuidv4();
          studentIds.push(id);
          studentBatch.push({
            id,
            name: faker.person.fullName().slice(0, 100),
            created_at: faker.date.past(),
          });
        }

        await db.batchInsert('students', studentBatch, batchSize);

        if ((i + batchSize) % 20_000 === 0 || i + batchSize === STUDENTS_COUNT) {
          logger.info({ progress: i + batchSize, total: STUDENTS_COUNT }, 'Students inserted');
        }
      }
    }

    // 3. Seed enrollments
    logger.info({ target: ENROLLMENTS_COUNT }, 'Seeding enrollments in batches...');
    for (let i = 0; i < ENROLLMENTS_COUNT; i += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, ENROLLMENTS_COUNT - i);
      const enrollmentBatch: EnrollmentRecord[] = [];

      for (let j = 0; j < batchSize; j += 1) {
        const studentId = studentIds[Math.floor(Math.random() * studentIds.length)] ?? uuidv4();
        const courseId =
          courseIds[Math.floor(Math.random() * courseIds.length)] ?? courseIds[0] ?? uuidv4();
        const completed = Math.random() > 0.15; // 85% completed
        const score = completed ? faker.number.int({ min: 50, max: 800 }) : 0;

        enrollmentBatch.push({
          id: uuidv4(),
          student_id: studentId,
          course_id: courseId,
          score,
          completed,
          completed_at: completed ? faker.date.recent() : null,
        });
      }

      await db.batchInsert('enrollments', enrollmentBatch, batchSize);

      if ((i + batchSize) % 50_000 === 0 || i + batchSize === ENROLLMENTS_COUNT) {
        logger.info({ progress: i + batchSize, total: ENROLLMENTS_COUNT }, 'Enrollments inserted');
      }
    }

    logger.info('Database seeding completed successfully');
  } catch (error: unknown) {
    logger.error({ err: error }, 'Failed to seed database');
    throw error;
  } finally {
    await db.destroy();
  }
};

if (process.argv[1]?.endsWith('seed.ts')) {
  void seed();
}
