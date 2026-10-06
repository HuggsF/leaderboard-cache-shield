import { setTimeout as delay } from 'node:timers/promises';
import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { CacheProvider, CachedValue } from '@application/interfaces/cache-provider';
import type { Clock } from '@application/interfaces/clock';
import type { DistributedLock, LockAcquireOptions } from '@application/interfaces/distributed-lock';
import type { LogContext, Logger } from '@application/interfaces/logger';
import type {
  LatencyLabel,
  MetricsCollector,
  MetricsSnapshot,
} from '@application/interfaces/metrics-collector';
import { LeaderboardEntry } from '@domain/entities/leaderboard-entry.entity';
import type { LeaderboardEntryProps } from '@domain/entities/leaderboard-entry.entity';
import { Leaderboard } from '@domain/entities/leaderboard.entity';
import type { LeaderboardRepository } from '@domain/repositories/leaderboard.repository';

// ── Domain fixtures ──────────────────────────────────────────────────────────

export const entryProps = (
  index: number,
  overrides: Partial<LeaderboardEntryProps> = {},
): LeaderboardEntryProps => ({
  studentId: `student-${index}`,
  studentName: `Student Number ${index}`,
  courseName: 'Advanced Algebra',
  totalScore: Math.max(0, 9_000 - index * 10),
  rank: index,
  completedCourses: 5,
  ...overrides,
});

export const buildEntry = (
  index: number,
  overrides: Partial<LeaderboardEntryProps> = {},
): LeaderboardEntry => {
  const result = LeaderboardEntry.create(entryProps(index, overrides));
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

export const GENERATED_AT = new Date('2026-10-05T19:00:00.000Z');

/** A valid page: `count` entries ranked from `(page - 1) * pageSize + 1`. */
export const buildLeaderboard = (
  options: { page?: number; pageSize?: number; count?: number; totalStudents?: number } = {},
): Leaderboard => {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 3;
  const count = options.count ?? pageSize;
  const first = (page - 1) * pageSize + 1;
  const result = Leaderboard.create({
    entries: Array.from({ length: count }, (_, index) => buildEntry(first + index)),
    generatedAt: GENERATED_AT,
    totalStudents: options.totalStudents ?? 100,
    pageSize,
    currentPage: page,
  });
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

export const leaderboardDto = (overrides: Partial<LeaderboardDTO> = {}): LeaderboardDTO => ({
  page: 1,
  pageSize: 3,
  totalStudents: 100,
  totalPages: 34,
  generatedAt: GENERATED_AT.toISOString(),
  entries: [
    {
      rank: 1,
      studentId: 'student-1',
      studentName: 'Student Number 1',
      courseName: 'Advanced Algebra',
      totalScore: 8_990,
      completedCourses: 5,
    },
  ],
  ...overrides,
});

// ── Ports ────────────────────────────────────────────────────────────────────

type Deferred = { promise: Promise<void>; resolve: () => void };

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/**
 * Counts calls; each call takes `delayMs` (real timers) or waits for `release()` when gated,
 * so tests can hold the "heavy query" open while concurrent requests pile up.
 */
export class FakeLeaderboardRepository implements LeaderboardRepository {
  calls = 0;
  failWith: Error | null = null;
  delayMs = 0;
  private gate: Deferred | null = null;

  constructor(private readonly leaderboard: Leaderboard = buildLeaderboard()) {}

  hold(): void {
    this.gate = deferred();
  }

  release(): void {
    this.gate?.resolve();
    this.gate = null;
  }

  async getLeaderboard(_page: number, _pageSize: number): Promise<Leaderboard> {
    this.calls += 1;
    if (this.gate !== null) {
      await this.gate.promise;
    }
    if (this.delayMs > 0) {
      await delay(this.delayMs);
    }
    await Promise.resolve();
    if (this.failWith !== null) {
      throw this.failWith;
    }
    return this.leaderboard;
  }
}

type StoredEntry<T> = { value: T; fresh: boolean };

/** Map-backed cache with the same fresh/stale semantics as the Redis adapter. */
export class InMemoryCacheProvider<T> implements CacheProvider<T> {
  readonly entries = new Map<string, StoredEntry<T>>();
  readonly writes: { key: string; ttl: number[] }[] = [];
  freshnessProbes = 0;
  failReadsWith: Error | null = null;
  failWritesWith: Error | null = null;

  seedFresh(key: string, value: T): void {
    this.entries.set(key, { value, fresh: true });
  }

  seedStale(key: string, value: T): void {
    this.entries.set(key, { value, fresh: false });
  }

  async get(key: string): Promise<T | null> {
    await this.tick();
    this.throwOnRead();
    return this.entries.get(key)?.value ?? null;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.tick();
    this.throwOnWrite();
    this.writes.push({ key, ttl: [ttlSeconds] });
    this.entries.set(key, { value, fresh: true });
  }

  async getWithStaleSupport(key: string): Promise<CachedValue<T>> {
    await this.tick();
    this.throwOnRead();
    const entry = this.entries.get(key);
    return entry === undefined
      ? { data: null, isStale: false }
      : { data: entry.value, isStale: !entry.fresh };
  }

  async setWithStaleSupport(
    key: string,
    value: T,
    freshTtlSeconds: number,
    staleTtlSeconds: number,
  ): Promise<void> {
    await this.tick();
    this.throwOnWrite();
    this.writes.push({ key, ttl: [freshTtlSeconds, staleTtlSeconds] });
    this.entries.set(key, { value, fresh: true });
  }

  async isFresh(key: string): Promise<boolean> {
    await this.tick();
    this.throwOnRead();
    this.freshnessProbes += 1;
    return this.entries.get(key)?.fresh ?? false;
  }

  private async tick(): Promise<void> {
    await Promise.resolve();
  }

  private throwOnRead(): void {
    if (this.failReadsWith !== null) {
      throw this.failReadsWith;
    }
  }

  private throwOnWrite(): void {
    if (this.failWritesWith !== null) {
      throw this.failWritesWith;
    }
  }
}

/** SET-NX-like lock: one holder per key, no expiry unless `expire()` is called. */
export class InMemoryDistributedLock implements DistributedLock {
  readonly holders = new Map<string, string>();
  readonly acquireOptions: (LockAcquireOptions | undefined)[] = [];
  acquired = 0;
  rejected = 0;
  failWith: Error | null = null;
  failReleaseWith: Error | null = null;
  private nextId = 0;

  async acquire(key: string, _ttlMs: number, options?: LockAcquireOptions): Promise<string | null> {
    await Promise.resolve();
    this.acquireOptions.push(options);
    if (this.failWith !== null) {
      throw this.failWith;
    }
    if (this.holders.has(key)) {
      this.rejected += 1;
      return null;
    }
    this.nextId += 1;
    const id = `lock-${this.nextId}`;
    this.holders.set(key, id);
    this.acquired += 1;
    return id;
  }

  async release(key: string, lockId: string): Promise<boolean> {
    await Promise.resolve();
    if (this.failReleaseWith !== null) {
      throw this.failReleaseWith;
    }
    if (this.holders.get(key) !== lockId) {
      return false;
    }
    this.holders.delete(key);
    return true;
  }

  /** Simulates the lease running out while the holder is still working. */
  expire(key: string): void {
    this.holders.delete(key);
  }
}

export class RecordingMetricsCollector implements MetricsCollector {
  readonly counts = {
    cacheHits: 0,
    cacheMisses: 0,
    staleServed: 0,
    lockWaits: 0,
    dbQueries: 0,
    dbQueryErrors: 0,
  };
  readonly latencies: { label: LatencyLabel; durationMs: number }[] = [];

  incrementCacheHit(): void {
    this.counts.cacheHits += 1;
  }

  incrementCacheMiss(): void {
    this.counts.cacheMisses += 1;
  }

  incrementStaleServed(): void {
    this.counts.staleServed += 1;
  }

  incrementLockWait(): void {
    this.counts.lockWaits += 1;
  }

  incrementDbQuery(): void {
    this.counts.dbQueries += 1;
  }

  incrementDbQueryError(): void {
    this.counts.dbQueryErrors += 1;
  }

  recordLatency(label: LatencyLabel, durationMs: number): void {
    this.latencies.push({ label, durationMs });
  }

  getMetrics(): MetricsSnapshot {
    const empty = { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    return { ...this.counts, latency: { response: empty, db_query: empty } };
  }
}

/** Real timers, for concurrency tests where requests genuinely overlap. */
export class RealClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return performance.now();
  }

  async sleep(ms: number): Promise<void> {
    await delay(ms);
  }
}

/** Virtual time: `sleep` advances the clock and yields once — timeouts happen instantly. */
export class ManualClock implements Clock {
  sleeps = 0;

  constructor(
    private currentMs = 0,
    private wallClock = new Date('2026-10-05T19:00:00.000Z'),
  ) {}

  now(): Date {
    return new Date(this.wallClock.getTime() + this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps += 1;
    this.currentMs += ms;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ── Logger ───────────────────────────────────────────────────────────────────

type LogFn = Logger['info'];
type LogMock = jest.Mock<ReturnType<LogFn>, Parameters<LogFn>>;

export type LoggerMock = { [K in keyof Logger]: LogMock };

const logMock = (): LogMock => jest.fn<ReturnType<LogFn>, [LogContext, string]>();

export const createLoggerMock = (): LoggerMock => ({
  debug: logMock(),
  info: logMock(),
  warn: logMock(),
  error: logMock(),
});

/** Waits until every pending microtask/immediate has run (background work in fakes). */
export const flushAsync = async (rounds = 5): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};
