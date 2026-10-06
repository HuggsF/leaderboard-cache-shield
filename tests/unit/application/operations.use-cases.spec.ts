import { leaderboardCacheKeys } from '@application/services/cache-keys';
import { toLeaderboardDto } from '@application/services/leaderboard.mapper';
import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import { ExportMetricsUseCase } from '@application/use-cases/export-metrics.use-case';
import { buildLeaderboard } from '../../support/fakes';

const clock = { nowMs: (): number => 12_400 };

describe('CheckHealthUseCase', () => {
  it('reports ok when every dependency is up', async () => {
    const useCase = new CheckHealthUseCase(
      [
        { name: 'mysql', check: () => Promise.resolve() },
        { name: 'redis', check: () => Promise.resolve() },
      ],
      clock,
    );

    const result = await useCase.execute();

    expect(result).toEqual({
      success: true,
      data: { status: 'ok', uptimeSeconds: 12, checks: { mysql: 'up', redis: 'up' } },
    });
  });

  it('reports degraded when a dependency fails', async () => {
    const useCase = new CheckHealthUseCase(
      [
        { name: 'mysql', check: () => Promise.resolve() },
        { name: 'redis', check: () => Promise.reject(new Error('ECONNREFUSED')) },
      ],
      clock,
    );

    const result = await useCase.execute();

    expect(result.success && result.data).toMatchObject({
      status: 'degraded',
      checks: { mysql: 'up', redis: 'down' },
    });
  });

  it('marks a dependency as down when its check exceeds the timeout', async () => {
    const useCase = new CheckHealthUseCase(
      [{ name: 'mysql', check: () => new Promise<void>(() => undefined) }],
      clock,
      20,
    );

    const result = await useCase.execute();

    expect(result.success && result.data.checks).toEqual({ mysql: 'down' });
  });
});

describe('ExportMetricsUseCase', () => {
  it('returns the exporter output', () => {
    const useCase = new ExportMetricsUseCase({
      contentType: 'text/plain; version=0.0.4',
      render: () => 'cache_hits_total{strategy="swr"} 3\n',
    });

    expect(useCase.execute()).toEqual({
      success: true,
      data: {
        contentType: 'text/plain; version=0.0.4',
        body: 'cache_hits_total{strategy="swr"} 3\n',
      },
    });
  });
});

describe('leaderboardCacheKeys', () => {
  it('follows the leaderboard:{ns}:page:{n}(:lock) pattern', () => {
    expect(leaderboardCacheKeys('v3', 7)).toEqual({
      entry: 'leaderboard:v3:page:7',
      lock: 'leaderboard:v3:page:7:lock',
    });
  });
});

describe('toLeaderboardDto', () => {
  it('maps the aggregate to a JSON-safe DTO', () => {
    const dto = toLeaderboardDto(buildLeaderboard({ page: 2, pageSize: 2, totalStudents: 5 }));

    expect(dto).toEqual({
      page: 2,
      pageSize: 2,
      totalStudents: 5,
      totalPages: 3,
      generatedAt: '2026-10-05T19:00:00.000Z',
      entries: [
        {
          rank: 3,
          studentId: 'student-3',
          studentName: 'Student Number 3',
          courseName: 'Advanced Algebra',
          totalScore: 8_970,
          completedCourses: 5,
        },
        {
          rank: 4,
          studentId: 'student-4',
          studentName: 'Student Number 4',
          courseName: 'Advanced Algebra',
          totalScore: 8_960,
          completedCourses: 5,
        },
      ],
    });
  });
});
