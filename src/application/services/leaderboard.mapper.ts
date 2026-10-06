import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { Leaderboard } from '@domain/entities/leaderboard.entity';

/** Domain → DTO. The DTO is the only shape that leaves the application layer (cache, HTTP). */
export const toLeaderboardDto = (leaderboard: Leaderboard): LeaderboardDTO => ({
  page: leaderboard.currentPage,
  pageSize: leaderboard.pageSize,
  totalStudents: leaderboard.totalStudents,
  totalPages: leaderboard.totalPages,
  generatedAt: leaderboard.generatedAt.toISOString(),
  entries: leaderboard.entries.map((entry) => ({
    rank: entry.rank.value,
    studentId: entry.studentId,
    studentName: entry.studentName.value,
    courseName: entry.courseName.value,
    totalScore: entry.totalScore.value,
    completedCourses: entry.completedCourses,
  })),
});
