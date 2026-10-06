import type { AppConfig } from '@infrastructure/config/env';
import { buildContainer, STRATEGY_LABELS } from '@infrastructure/config/container';
import { createLoggerMock, RealClock } from '../../support/fakes';
import type { Knex } from 'knex';
import * as redisClientModule from '@infrastructure/cache/redis-client';
import type { Redis } from 'ioredis';

describe('Dependency Injection Container', () => {
  const dummyConfig: AppConfig = {
    env: 'test',
    http: { host: '127.0.0.1', port: 3000, backlog: 1024 },
    log: { level: 'silent', pretty: false, requests: false },
    database: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'pwd',
      name: 'db',
      pool: { min: 1, max: 5 },
      acquireTimeoutMs: 5000,
      migrateOnStart: false,
    },
    redis: { host: 'localhost', port: 6379, password: undefined, db: 0 },
    leaderboard: { pageSize: 50, queryDelayMs: 0 },
    cache: { freshTtlSeconds: 300, staleTtlSeconds: 600 },
    lock: {
      ttlMs: 5000,
      retryCount: 3,
      retryDelayMs: 200,
      retryJitterMs: 50,
      waitTimeoutMs: 2000,
      pollIntervalMs: 20,
    },
    shutdownTimeoutMs: 10_000,
  };

  const logger = createLoggerMock();
  const clock = new RealClock();
  const dbMock = {
    raw: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  } as unknown as Knex;

  const fakeRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    status: 'ready',
    on: jest.fn(),
  } as unknown as Redis;

  beforeEach(() => {
    jest.spyOn(redisClientModule, 'createRedisClient').mockReturnValue(fakeRedisClient);
    jest.spyOn(redisClientModule, 'closeRedis').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds container with all use cases, ports, and lifecycle tasks wired', async () => {
    const container = buildContainer(dummyConfig, logger as never, {
      db: dbMock,
      clock,
    });

    expect(container.config).toBe(dummyConfig);
    expect(container.getLeaderboardNaive).toBeDefined();
    expect(container.getLeaderboardWithLock).toBeDefined();
    expect(container.getLeaderboardSWR).toBeDefined();
    expect(container.checkHealth).toBeDefined();
    expect(container.exportMetrics).toBeDefined();

    const tasks = container.shutdownTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(4);

    for (const task of tasks) {
      await expect(task.close()).resolves.toBeUndefined();
    }
  });

  it('exposes correct strategy labels', () => {
    expect(STRATEGY_LABELS).toEqual({
      naive: 'naive',
      lock: 'lock',
      swr: 'swr',
    });
  });
});
