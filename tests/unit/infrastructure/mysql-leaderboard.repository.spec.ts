import type { Knex } from 'knex';
import {
  LeaderboardDataIntegrityError,
  MySqlLeaderboardRepository,
} from '@infrastructure/database/mysql-leaderboard.repository';
import { RealClock } from '../../support/fakes';

describe('MySqlLeaderboardRepository', () => {
  const clock = new RealClock();

  it('queries MySQL, parses rows with Zod, and creates a valid domain Leaderboard entity', async () => {
    const rawRows = [
      {
        student_id: 'student-1',
        student_name: 'Student One',
        total_score: 9500,
        completed_courses: 5,
        rank: 1,
        total_students: 100,
        top_course: 'Advanced Architecture',
      },
      {
        student_id: 'student-2',
        student_name: 'Student Two',
        total_score: 9200,
        completed_courses: 4,
        rank: 2,
        total_students: 100,
        top_course: 'Basic Mathematics',
      },
    ];

    const mockDb = {
      raw: jest.fn().mockResolvedValue([rawRows, []]),
    } as unknown as Knex;

    const repository = new MySqlLeaderboardRepository(mockDb, clock, { queryDelayMs: 0 });
    const leaderboard = await repository.getLeaderboard(1, 2);

    expect(leaderboard.currentPage).toBe(1);
    expect(leaderboard.pageSize).toBe(2);
    expect(leaderboard.totalStudents).toBe(100);
    expect(leaderboard.entries).toHaveLength(2);
    expect(leaderboard.entries[0]?.studentName.value).toBe('Student One');
    expect(leaderboard.entries[0]?.courseName.value).toBe('Advanced Architecture');
    expect(leaderboard.entries[1]?.courseName.value).toBe('Basic Mathematics');
  });

  it('counts ranked students when page has no rows (offset past end)', async () => {
    const mockDb = {
      raw: jest
        .fn()
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[{ total: 42 }], []]),
    } as unknown as Knex;

    const repository = new MySqlLeaderboardRepository(mockDb, clock, { queryDelayMs: 0 });
    const leaderboard = await repository.getLeaderboard(10, 5);

    expect(leaderboard.entries).toHaveLength(0);
    expect(leaderboard.totalStudents).toBe(42);
  });

  it('throws LeaderboardDataIntegrityError when database returns invalid domain values', async () => {
    const rawRows = [
      {
        student_id: 'student-1',
        student_name: 'Student One',
        total_score: 99_999, // Exceeds Score maximum of 10,000!
        completed_courses: 5,
        rank: 1,
        total_students: 100,
        top_course: 'Advanced Architecture',
      },
    ];

    const mockDb = {
      raw: jest.fn().mockResolvedValue([rawRows, []]),
    } as unknown as Knex;

    const repository = new MySqlLeaderboardRepository(mockDb, clock, { queryDelayMs: 0 });
    await expect(repository.getLeaderboard(1, 10)).rejects.toThrow(LeaderboardDataIntegrityError);
  });
});
