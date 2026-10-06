import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import { LeaderboardUnavailableError } from '@application/errors/leaderboard-unavailable.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Clock } from '@application/interfaces/clock';
import type { CachePolicy, LockPolicy } from '@application/services/cache-policy';
import { LeaderboardLoader } from '@application/services/leaderboard-loader';
import { LockGuardedRefresher } from '@application/services/lock-guarded-refresher';
import { GetLeaderboardWithLockUseCase } from '@application/use-cases/get-leaderboard-with-lock.use-case';
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

const ENTRY = 'leaderboard:v2:page:1';
const LOCK = `${ENTRY}:lock`;
const CACHE_POLICY: CachePolicy = { pageSize: 3, freshTtlSeconds: 300, staleTtlSeconds: 600 };
const LOCK_POLICY: LockPolicy = { lockTtlMs: 10_000, waitTimeoutMs: 2_000, pollIntervalMs: 5 };

type LockTestHarness = {
  useCase: GetLeaderboardWithLockUseCase;
  cache: InMemoryCacheProvider<LeaderboardDTO>;
  lock: InMemoryDistributedLock;
  repository: FakeLeaderboardRepository;
  metrics: RecordingMetricsCollector;
  logger: ReturnType<typeof createLoggerMock>;
};

const setup = (clock: Clock = new RealClock()): LockTestHarness => {
  const cache = new InMemoryCacheProvider<LeaderboardDTO>();
  const lock = new InMemoryDistributedLock();
  const repository = new FakeLeaderboardRepository();
  const metrics = new RecordingMetricsCollector();
  const logger = createLoggerMock();
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
  const useCase = new GetLeaderboardWithLockUseCase(cache, refresher, clock, metrics, {
    pageSize: CACHE_POLICY.pageSize,
    waitTimeoutMs: LOCK_POLICY.waitTimeoutMs,
  });
  return { useCase, cache, lock, repository, metrics, logger };
};

describe('GetLeaderboardWithLockUseCase (v2)', () => {
  it('serves a fresh entry without taking the lock', async () => {
    const { useCase, cache, lock, repository, metrics } = setup();
    cache.seedFresh(ENTRY, leaderboardDto());

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('HIT');
    expect(lock.acquired).toBe(0);
    expect(repository.calls).toBe(0);
    expect(metrics.counts.cacheHits).toBe(1);
  });

  it('rebuilds a missing entry under the lock, with fresh + stale TTLs, and releases it', async () => {
    const { useCase, cache, lock, repository, metrics } = setup();

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('MISS');
    expect(repository.calls).toBe(1);
    expect(cache.writes).toEqual([{ key: ENTRY, ttl: [300, 600] }]);
    expect(lock.acquireOptions).toEqual([undefined]);
    expect(lock.holders.size).toBe(0);
    expect(metrics.counts).toMatchObject({ cacheMisses: 1, dbQueries: 1, lockWaits: 0 });
  });

  it('treats a stale entry as a miss and refreshes it synchronously', async () => {
    const { useCase, cache, repository } = setup();
    cache.seedStale(ENTRY, leaderboardDto({ totalStudents: 1 }));

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('MISS');
    expect(result.success && result.data.leaderboard.totalStudents).toBe(100);
    expect(repository.calls).toBe(1);
  });

  it('PROTECTED: 100 concurrent requests on a missing entry run exactly ONE heavy query', async () => {
    const { useCase, lock, repository, metrics } = setup();
    repository.hold();

    const pending = Array.from({ length: 100 }, () => useCase.execute({ page: 1 }));
    await flushAsync(10);
    repository.release();
    const results = await Promise.all(pending);

    const statuses = results.map((result) => (result.success ? result.data.cacheStatus : 'ERROR'));
    expect(repository.calls).toBe(1);
    expect(statuses.filter((status) => status === 'MISS')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'COALESCED')).toHaveLength(99);
    expect(lock.acquired).toBe(1);
    expect(lock.rejected).toBe(99);
    expect(metrics.counts).toMatchObject({ dbQueries: 1, cacheMisses: 100, lockWaits: 99 });
  });

  it('falls back to the stale copy when the rebuild takes longer than the wait budget', async () => {
    const clock = new ManualClock();
    const { useCase, cache, lock, repository, metrics } = setup(clock);
    cache.seedStale(ENTRY, leaderboardDto({ totalStudents: 7 }));
    await lock.acquire(LOCK, 10_000); // another instance is (slowly) rebuilding

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('STALE');
    expect(result.success && result.data.leaderboard.totalStudents).toBe(7);
    expect(repository.calls).toBe(0);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(LOCK_POLICY.waitTimeoutMs);
    expect(metrics.counts).toMatchObject({ staleServed: 1, lockWaits: 1, dbQueries: 0 });
  });

  it('answers LeaderboardUnavailable (never queries) when there is nothing to fall back to', async () => {
    const clock = new ManualClock();
    const { useCase, lock, repository } = setup(clock);
    await lock.acquire(LOCK, 10_000);

    const result = await useCase.execute({ page: 1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(LeaderboardUnavailableError);
      expect(result.error.code).toBe('LEADERBOARD_UNAVAILABLE');
      expect(result.error.message).toContain('waited 2000 ms');
    }
    expect(repository.calls).toBe(0);
  });

  it('skips the query when the entry became fresh while acquiring the lock (double check)', async () => {
    const { useCase, cache, lock, repository } = setup();
    const acquire = lock.acquire.bind(lock);
    jest.spyOn(lock, 'acquire').mockImplementation(async (key, ttl, options) => {
      cache.seedFresh(ENTRY, leaderboardDto({ totalStudents: 55 })); // previous holder finished
      return acquire(key, ttl, options);
    });

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('COALESCED');
    expect(result.success && result.data.leaderboard.totalStudents).toBe(55);
    expect(repository.calls).toBe(0);
    expect(lock.holders.size).toBe(0);
  });

  it('warns when the lock expired before release (query slower than the lock TTL)', async () => {
    const { useCase, lock, repository, logger } = setup();
    repository.hold();

    const pending = useCase.execute({ page: 1 });
    await flushAsync();
    lock.expire(LOCK);
    repository.release();
    const result = await pending;

    expect(result.success && result.data.cacheStatus).toBe('MISS');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ lockKey: LOCK, lockTtlMs: 10_000 }),
      'Lock expired before release: the refresh took longer than the lock TTL',
    );
  });

  it('answers anyway when releasing the lock fails (the lease will expire)', async () => {
    const { useCase, lock, logger } = setup();
    lock.failReleaseWith = new Error('ETIMEDOUT');

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('MISS');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ lockKey: LOCK }),
      'Could not release the lock; it will expire',
    );
  });

  it('releases the lock and returns an UnexpectedError when MySQL fails', async () => {
    const { useCase, lock, repository } = setup();
    repository.failWith = new Error('ER_LOCK_DEADLOCK');

    const result = await useCase.execute({ page: 1 });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(lock.holders.size).toBe(0);
  });

  it('returns an UnexpectedError when the lock backend is down (fails closed)', async () => {
    const { useCase, lock, repository } = setup();
    lock.failWith = new Error('ECONNREFUSED');

    const result = await useCase.execute({ page: 1 });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(repository.calls).toBe(0);
  });

  it('still answers when the cache write fails', async () => {
    const { useCase, cache, logger } = setup();
    cache.failWritesWith = new Error('READONLY');

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('MISS');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: ENTRY }),
      'Could not write the leaderboard to the cache',
    );
  });

  it('keeps polling when the entry turns fresh but disappears before it is read', async () => {
    const clock = new ManualClock();
    const { useCase, cache, lock } = setup(clock);
    await lock.acquire(LOCK, 10_000);
    let probes = 0;
    jest.spyOn(cache, 'isFresh').mockImplementation(async () => {
      await Promise.resolve();
      probes += 1;
      if (probes === 2) {
        cache.seedFresh(ENTRY, leaderboardDto({ totalStudents: 9 }));
      }
      return probes >= 1;
    });
    const read = cache.getWithStaleSupport.bind(cache);
    let reads = 0;
    jest.spyOn(cache, 'getWithStaleSupport').mockImplementation(async (key) => {
      reads += 1;
      return reads === 2 ? { data: null, isStale: false } : read(key);
    });

    const result = await useCase.execute({ page: 1 });

    expect(result.success && result.data.cacheStatus).toBe('COALESCED');
    expect(result.success && result.data.leaderboard.totalStudents).toBe(9);
  });
});
