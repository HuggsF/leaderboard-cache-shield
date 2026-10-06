import type { Redis } from 'ioredis';
import type { Knex } from 'knex';
import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { CacheProvider } from '@application/interfaces/cache-provider';
import type { Clock } from '@application/interfaces/clock';
import type { CachePolicy, LockPolicy } from '@application/services/cache-policy';
import { LeaderboardLoader } from '@application/services/leaderboard-loader';
import { LockGuardedRefresher } from '@application/services/lock-guarded-refresher';
import type { RefreshOutcome } from '@application/services/lock-guarded-refresher';
import { SingleFlight } from '@application/services/single-flight';
import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import { ExportMetricsUseCase } from '@application/use-cases/export-metrics.use-case';
import { GetLeaderboardNaiveUseCase } from '@application/use-cases/get-leaderboard-naive.use-case';
import { GetLeaderboardSWRUseCase } from '@application/use-cases/get-leaderboard-swr.use-case';
import { GetLeaderboardWithLockUseCase } from '@application/use-cases/get-leaderboard-with-lock.use-case';
import { leaderboardCodec } from '@infrastructure/cache/cache-codec';
import { RedisCacheProvider } from '@infrastructure/cache/redis-cache-provider';
import { closeRedis, createRedisClient, pingRedis } from '@infrastructure/cache/redis-client';
import type { AppConfig } from '@infrastructure/config/env';
import { createDatabase, pingDatabase } from '@infrastructure/database/knex';
import { MySqlLeaderboardRepository } from '@infrastructure/database/mysql-leaderboard.repository';
import type { ShutdownTask } from '@infrastructure/lifecycle/graceful-shutdown';
import {
  createRedlock,
  RedlockDistributedLock,
} from '@infrastructure/lock/redlock-distributed-lock';
import type { AppLogger } from '@infrastructure/logging/logger';
import { MetricsRegistry } from '@infrastructure/metrics/metrics-registry';
import { SystemClock } from '@infrastructure/system/system-clock';

/** Metric label of each strategy (the cache namespaces are v1/v2/v3, like the API). */
export const STRATEGY_LABELS = { naive: 'naive', lock: 'lock', swr: 'swr' } as const;

export type Container = {
  readonly config: AppConfig;
  /** pino: satisfies the application's Logger port and Fastify's logger contract. */
  readonly logger: AppLogger;
  readonly db: Knex;
  readonly redis: { readonly cache: Redis; readonly lock: Redis };
  readonly metrics: MetricsRegistry;
  readonly getLeaderboardNaive: GetLeaderboardNaiveUseCase;
  readonly getLeaderboardWithLock: GetLeaderboardWithLockUseCase;
  readonly getLeaderboardSWR: GetLeaderboardSWRUseCase;
  readonly checkHealth: CheckHealthUseCase;
  readonly exportMetrics: ExportMetricsUseCase;
  /** SWR refreshes running in the background — drained on shutdown. */
  readonly backgroundRevalidations: SingleFlight<void>;
  /** Releases everything except the HTTP server, in dependency order. */
  readonly shutdownTasks: () => ShutdownTask[];
};

export type ContainerOverrides = {
  /** Reuse an existing pool (tests). Not destroyed by the container's shutdown tasks. */
  readonly db?: Knex;
  readonly clock?: Clock;
};

/** Composition root: the only place where concrete adapters are wired to the use cases. */
export const buildContainer = (
  config: AppConfig,
  logger: AppLogger,
  overrides: ContainerOverrides = {},
): Container => {
  const clock = overrides.clock ?? new SystemClock();
  const db = overrides.db ?? createDatabase(config.database);
  // Two connections: lock commands never queue behind thousands of cache payloads.
  const cacheClient = createRedisClient(config.redis, 'leaderboard-cache', logger);
  const lockClient = createRedisClient(config.redis, 'leaderboard-lock', logger);

  const metrics = new MetricsRegistry({
    info: {
      page_size: config.leaderboard.pageSize,
      query_delay_ms: config.leaderboard.queryDelayMs,
      fresh_ttl_seconds: config.cache.freshTtlSeconds,
      stale_ttl_seconds: config.cache.staleTtlSeconds,
      lock_ttl_ms: config.lock.ttlMs,
      lock_wait_timeout_ms: config.lock.waitTimeoutMs,
      db_pool_max: config.database.pool.max,
      db_acquire_timeout_ms: config.database.acquireTimeoutMs,
    },
  });
  const cache: CacheProvider<LeaderboardDTO> = new RedisCacheProvider(
    cacheClient,
    leaderboardCodec,
    logger,
  );
  const lock = new RedlockDistributedLock(
    createRedlock(lockClient, {
      retryCount: config.lock.retryCount,
      retryDelayMs: config.lock.retryDelayMs,
      retryJitterMs: config.lock.retryJitterMs,
    }),
  );
  const repository = new MySqlLeaderboardRepository(db, clock, {
    queryDelayMs: config.leaderboard.queryDelayMs,
  });

  const cachePolicy: CachePolicy = {
    pageSize: config.leaderboard.pageSize,
    freshTtlSeconds: config.cache.freshTtlSeconds,
    staleTtlSeconds: config.cache.staleTtlSeconds,
  };
  const lockPolicy: LockPolicy = {
    lockTtlMs: config.lock.ttlMs,
    waitTimeoutMs: config.lock.waitTimeoutMs,
    pollIntervalMs: config.lock.pollIntervalMs,
  };
  const strategyPolicy = {
    pageSize: cachePolicy.pageSize,
    waitTimeoutMs: lockPolicy.waitTimeoutMs,
  };

  const naiveMetrics = metrics.scope(STRATEGY_LABELS.naive);
  const lockMetrics = metrics.scope(STRATEGY_LABELS.lock);
  const swrMetrics = metrics.scope(STRATEGY_LABELS.swr);
  const refresherFor = (strategyMetrics: typeof lockMetrics): LockGuardedRefresher =>
    new LockGuardedRefresher(
      cache,
      lock,
      new LeaderboardLoader(repository, clock, strategyMetrics),
      clock,
      strategyMetrics,
      logger,
      cachePolicy,
      lockPolicy,
    );

  const backgroundRevalidations = new SingleFlight<void>();

  return {
    config,
    logger,
    db,
    redis: { cache: cacheClient, lock: lockClient },
    metrics,
    getLeaderboardNaive: new GetLeaderboardNaiveUseCase(
      cache,
      new LeaderboardLoader(repository, clock, naiveMetrics),
      clock,
      naiveMetrics,
      logger,
      cachePolicy,
    ),
    getLeaderboardWithLock: new GetLeaderboardWithLockUseCase(
      cache,
      refresherFor(lockMetrics),
      clock,
      lockMetrics,
      strategyPolicy,
    ),
    getLeaderboardSWR: new GetLeaderboardSWRUseCase(
      cache,
      refresherFor(swrMetrics),
      backgroundRevalidations,
      new SingleFlight<RefreshOutcome | null>(),
      clock,
      swrMetrics,
      strategyPolicy,
    ),
    checkHealth: new CheckHealthUseCase(
      [
        { name: 'mysql', check: () => pingDatabase(db) },
        { name: 'redis', check: () => pingRedis(cacheClient) },
      ],
      clock,
    ),
    exportMetrics: new ExportMetricsUseCase(metrics),
    backgroundRevalidations,
    shutdownTasks: () => [
      { name: 'swr-background-refreshes', close: () => backgroundRevalidations.drain() },
      { name: 'redis-cache', close: () => closeRedis(cacheClient) },
      { name: 'redis-lock', close: () => closeRedis(lockClient) },
      ...(overrides.db === undefined ? [{ name: 'mysql', close: () => db.destroy() }] : []),
      {
        name: 'metrics',
        close: () => {
          metrics.close();
          return Promise.resolve();
        },
      },
    ],
  };
};
