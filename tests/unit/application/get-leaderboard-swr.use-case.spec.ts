import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import { LeaderboardUnavailableError } from '@application/errors/leaderboard-unavailable.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Clock } from '@application/interfaces/clock';
import type { CachePolicy, LockPolicy } from '@application/services/cache-policy';
import { LeaderboardLoader } from '@application/services/leaderboard-loader';
import { LockGuardedRefresher } from '@application/services/lock-guarded-refresher';
import type { RefreshOutcome } from '@application/services/lock-guarded-refresher';
import { SingleFlight } from '@application/services/single-flight';
import { GetLeaderboardSWRUseCase } from '@application/use-cases/get-leaderboard-swr.use-case';
import {
  createLoggerMock,
  FakeLeaderboardRepository,
  flushAsync,
  InMemoryCacheProvider,
  InMemoryDistributedLock,
  leaderboardDto,
  ManualClock,
  RealClock,
  RecordingMetricsCollector,
} from '../../support/fakes';

const ENTRY = 'leaderboard:v3:page:1';
const LOCK = `${ENTRY}:lock`;
const CACHE_POLICY: CachePolicy = { pageSize: 3, freshTtlSeconds: 300, staleTtlSeconds: 600 };
const LOCK_POLICY: LockPolicy = { lockTtlMs: 10_000, waitTimeoutMs: 2_000, pollIntervalMs: 5 };

type SwrTestHarness = {
  useCase: GetLeaderboardSWRUseCase;
  cache: InMemoryCacheProvider<LeaderboardDTO>;
  lock: InMemoryDistributedLock;
  repository: FakeLeaderboardRepository;
  metrics: RecordingMetricsCollector;
  logger: ReturnType<typeof createLoggerMock>;
  revalidations: SingleFlight<void>;
};

const setup = (clock: Clock = new RealClock()): SwrTestHarness => {
  const cache = new InMemoryCacheProvider<LeaderboardDTO>();
  const lock = new InMemoryDistributedLock();
  const repository = new FakeLeaderboardRepository();
  const metrics = new RecordingMetricsCollector();
  const logger = createLoggerMock();
  const revalidations = new SingleFlight<void>();
  const refresher = new LockGuardedRefresher(
    cache,
    lock,
    new LeaderboardLoader(repository, clock, metrics),
    clock,
    metrics,
    logger,
    CACHE_POLICY,
    LOCK_POLICY,
  );
  const useCase = new GetLeaderboardSWRUseCase(
    cache,
    refresher,
    revalidations,
    new SingleFlight<RefreshOutcome | null>(),
    clock,
    metrics,
    { pageSize: CACHE_POLICY.pageSize, waitTimeoutMs: LOCK_POLICY.waitTimeoutMs },
  );
  return { useCase, cache, lock, repository, metrics, logger, revalidations };
};

const statusesOf = (
  results: Awaited<ReturnType<GetLeaderboardSWRUseCase['execute']>>[],
): string[] => results.map((result) => (result.success ? result.data.cacheStatus : 'ERROR'));

describe('GetLeaderboardSWRUseCase (v3)', () => {
  it('serves a fresh entry immediately', async () => {
    const { useCase, cache, repository, metrics } = setup();
    cache.seedFresh(ENTRY, leaderboardDto());

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('HIT');
    expect(repository.calls).toBe(0);
    expect(metrics.counts).toMatchObject({ cacheHits: 1, staleServed: 0 });
  });

  it('serves a stale entry immediately and refreshes it in the background', async () => {
    const { useCase, cache, lock, repository, revalidations } = setup();
    cache.seedStale(ENTRY, leaderboardDto({ totalStudents: 1 }));
    repository.hold();

    const result = await useCase.execute({ page: 1 });

    // The response did not wait for MySQL…
    expect(result.success && result.data.cacheStatus).toBe('STALE');
    expect(result.success && result.data.leaderboard.totalStudents).toBe(1);
    expect(revalidations.size).toBe(1);
    // …which runs in the background and makes the entry fresh again.
    repository.release();
    await revalidations.drain();
    const refreshed = await cache.getWithStaleSupport(ENTRY);
    expect(refreshed).toEqual({
      data: expect.objectContaining({ totalStudents: 100 }) as unknown,
      isStale: false,
    });
    expect(repository.calls).toBe(1);
    expect(lock.acquireOptions).toEqual([{ retryCount: 0 }]);
    expect(lock.holders.size).toBe(0);
  });

  it('PROTECTED: 100 concurrent requests on a stale entry -> 100 instant answers, ONE query', async () => {
    const { useCase, cache, lock, repository, metrics, revalidations } = setup();
    cache.seedStale(ENTRY, leaderboardDto());
    repository.hold();

    const results = await Promise.all(
      Array.from({ length: 100 }, () => useCase.execute({ page: 1 })),
    );

    expect(statusesOf(results).every((status) => status === 'STALE')).toBe(true);
    repository.release();
    await revalidations.drain();
    expect(repository.calls).toBe(1);
    expect(lock.acquired).toBe(1);
    expect(metrics.counts).toMatchObject({
      cacheHits: 100,
      staleServed: 100,
      cacheMisses: 0,
      dbQueries: 1,
    });
  });

  it('skips the background refresh when another instance holds the lock', async () => {
    const { useCase, cache, lock, repository, revalidations } = setup();
    cache.seedStale(ENTRY, leaderboardDto());
    await lock.acquire(LOCK, 10_000);

    const result = await useCase.execute({ page: 1 });
    await revalidations.drain();

    expect(result.success && result.data.cacheStatus).toBe('STALE');
    expect(repository.calls).toBe(0);
  });

  it('keeps serving stale data when the background refresh fails', async () => {
    const { useCase, cache, repository, metrics, logger, revalidations } = setup();
    cache.seedStale(ENTRY, leaderboardDto());
    repository.failWith = new Error('MySQL has gone away');

    const result = await useCase.execute({ page: 1 });
    await revalidations.drain();

    expect(result.success && result.data.cacheStatus).toBe('STALE');
    expect(metrics.counts.dbQueryErrors).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: ENTRY }),
      'Background revalidation failed; the stale entry keeps being served',
    );
    const entry = await cache.getWithStaleSupport(ENTRY);
    expect(entry.isStale).toBe(true);
  });

  it('logs the outcome of a background refresh that found the entry already fresh', async () => {
    const { useCase, cache, lock, repository, logger, revalidations } = setup();
    cache.seedStale(ENTRY, leaderboardDto());
    const acquire = lock.acquire.bind(lock);
    jest.spyOn(lock, 'acquire').mockImplementation(async (key, ttl, options) => {
      cache.seedFresh(ENTRY, leaderboardDto()); // another instance refreshed meanwhile
      return acquire(key, ttl, options);
    });

    await useCase.execute({ page: 1 });
    await revalidations.drain();

    expect(repository.calls).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      { key: ENTRY, cacheStatus: 'COALESCED' },
      'Background revalidation finished',
    );
  });

  it('COLD cache: 100 concurrent requests are coalesced into ONE query', async () => {
    const { useCase, lock, repository, metrics } = setup();
    repository.hold();

    const pending = Array.from({ length: 100 }, () => useCase.execute({ page: 1 }));
    await flushAsync(10);
    repository.release();
    const statuses = statusesOf(await Promise.all(pending));

    expect(repository.calls).toBe(1);
    expect(lock.acquired).toBe(1);
    expect(statuses.filter((status) => status === 'MISS')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'COALESCED')).toHaveLength(99);
    expect(metrics.counts).toMatchObject({ cacheMisses: 100, dbQueries: 1 });
  });

  it('COLD cache with another instance rebuilding: waits for its result', async () => {
    const { useCase, cache, lock, repository } = setup();
    await lock.acquire(LOCK, 10_000);
    setTimeout(() => {
      cache.seedFresh(ENTRY, leaderboardDto({ totalStudents: 77 }));
    }, 20);

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('COALESCED');
    expect(result.success && result.data.leaderboard.totalStudents).toBe(77);
    expect(repository.calls).toBe(0);
  });

  it('COLD cache and no rebuild finishing in time: 503-style error, MySQL untouched', async () => {
    const clock = new ManualClock();
    const { useCase, lock, repository } = setup(clock);
    await lock.acquire(LOCK, 10_000);

    const result = await useCase.execute({ page: 1 });

    expect(!result.success && result.error).toBeInstanceOf(LeaderboardUnavailableError);
    expect(repository.calls).toBe(0);
  });

  it('returns an UnexpectedError when the cold load fails', async () => {
    const { useCase, repository } = setup();
    repository.failWith = new Error('ER_ACCESS_DENIED_ERROR');

    const result = await useCase.execute({ page: 1 });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
  });

  it('rejects an invalid page', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ page: 20_000 });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.code).toBe('INVALID_PAGE_REQUEST');
  });
});
