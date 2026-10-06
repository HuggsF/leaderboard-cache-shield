import { z } from 'zod';

/** `?page=` — shape only; the allowed range is a domain rule (PageRequest). */
export const leaderboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

const integer = { type: 'integer' } as const;
const string = { type: 'string' } as const;

/**
 * JSON Schema of the 200 response: Fastify compiles it into a dedicated serializer
 * (fast-json-stringify), noticeably faster than JSON.stringify on the hot path, and it
 * guarantees that only these fields ever leave the API.
 */
export const leaderboardResponseSchema = {
  type: 'object',
  required: ['page', 'pageSize', 'totalStudents', 'totalPages', 'generatedAt', 'entries'],
  properties: {
    page: integer,
    pageSize: integer,
    totalStudents: integer,
    totalPages: integer,
    generatedAt: string,
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'rank',
          'studentId',
          'studentName',
          'courseName',
          'totalScore',
          'completedCourses',
        ],
        properties: {
          rank: integer,
          studentId: string,
          studentName: string,
          courseName: string,
          totalScore: integer,
          completedCourses: integer,
        },
      },
    },
  },
} as const;
