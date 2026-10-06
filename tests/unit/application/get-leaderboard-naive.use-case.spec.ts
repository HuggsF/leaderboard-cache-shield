import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { LeaderboardLoader } from '@application/services/leaderboard-loader';
import { GetLeaderboardNaiveUseCase } from '@application/use-cases/get-leaderboard-naive.use-case';
import { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import {
  createLoggerMock,
  FakeLeaderboardRepository,
  flushAsync,
  InMemoryCacheProvider,
  leaderboardDto,
  RealClock,
  RecordingMetricsCollector,
} from '../../support/fakes';

const KEY = 'leaderboard:v1:page:1';

const setup = (): {
  useCase: GetLeaderboardNaiveUseCase;
  cache: InMemoryCacheProvider<LeaderboardDTO>;
  repository: FakeLeaderboardRepository;
  metrics: RecordingMetricsCollector;
  logger: ReturnType<typeof createLoggerMock>;
} => {
  const cache = new InMemoryCacheProvider<LeaderboardDTO>();
  const repository = new FakeLeaderboardRepository();
  const metrics = new RecordingMetricsCollector();
  const logger = createLoggerMock();
  const clock = new RealClock();
  const useCase = new GetLeaderboardNaiveUseCase(
    cache,
    new LeaderboardLoader(repository, clock, metrics),
    clock,
    metrics,
    logger,
    { pageSize: 3, freshTtlSeconds: 300 },
  );
  return { useCase, cache, repository, metrics, logger };
};

describe('GetLeaderboardNaiveUseCase (v1)', () => {
  it('queries MySQL on a miss, caches the page with the TTL, then serves hits', async () => {
    const { useCase, cache, repository, metrics } = setup();

    const first = await useCase.execute({ page: 1 });
    const second = await useCase.execute({ page: 1 });

    expect(first.success && first.data.cacheStatus).toBe('MISS');
    expect(second.success && second.data.cacheStatus).toBe('HIT');
    expect(second.success && second.data.leaderboard).toEqual(
      first.success && first.data.leaderboard,
    );
    expect(first.success && first.data.leaderboard).toMatchObject({
      page: 1,
      pageSize: 3,
      totalStudents: 100,
      totalPages: 34,
      generatedAt: '2026-10-05T19:00:00.000Z',
    });
    expect(repository.calls).toBe(1);
    expect(cache.writes).toEqual([{ key: KEY, ttl: [300] }]);
    expect(metrics.counts).toMatchObject({ cacheHits: 1, cacheMisses: 1, dbQueries: 1 });
    expect(metrics.latencies.filter((sample) => sample.label === 'response')).toHaveLength(2);
    expect(metrics.latencies.filter((sample) => sample.label === 'db_query')).toHaveLength(1);
  });

  it('serves an existing entry without touching MySQL', async () => {
    const { useCase, cache, repository } = setup();
    cache.seedFresh(KEY, leaderboardDto({ totalStudents: 42 }));

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.leaderboard.totalStudents).toBe(42);
    expect(repository.calls).toBe(0);
  });

  it('STAMPEDE: 100 concurrent requests on an expired entry run 100 heavy queries', async () => {
    const { useCase, repository, metrics } = setup();
    repository.hold();

    const pending = Array.from({ length: 100 }, () => useCase.execute({ page: 1 }));
    await flushAsync();
    repository.release();
    const results = await Promise.all(pending);

    expect(results.every((result) => result.success && result.data.cacheStatus === 'MISS')).toBe(
      true,
    );
    expect(repository.calls).toBe(100);
    expect(metrics.counts.dbQueries).toBe(100);
    expect(metrics.counts.cacheMisses).toBe(100);
  });

  it('rejects an invalid page before touching any dependency', async () => {
    const { useCase, repository, metrics } = setup();

    const result = await useCase.execute({ page: 0 });

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toBeInstanceOf(InvalidPageRequestError);
    expect(repository.calls).toBe(0);
    expect(metrics.latencies).toHaveLength(0);
  });

  it('returns an UnexpectedError when MySQL fails, and counts the failed query', async () => {
    const { useCase, repository, metrics } = setup();
    repository.failWith = new Error('Knex: Timeout acquiring a connection');

    const result = await useCase.execute({ page: 1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(UnexpectedError);
      expect(result.error.message).toContain('Timeout acquiring a connection');
    }
    expect(metrics.counts).toMatchObject({ dbQueries: 1, dbQueryErrors: 1 });
  });

  it('returns an UnexpectedError when Redis is unreachable (never falls through to MySQL)', async () => {
    const { useCase, cache, repository } = setup();
    cache.failReadsWith = new Error('ECONNREFUSED');

    const result = await useCase.execute({ page: 1 });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(repository.calls).toBe(0);
  });

  it('still answers when the cache write fails', async () => {
    const { useCase, cache, logger } = setup();
    cache.failWritesWith = new Error('OOM command not allowed');

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('MISS');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY }),
      'Could not write the leaderboard to the cache',
    );
  });
});
