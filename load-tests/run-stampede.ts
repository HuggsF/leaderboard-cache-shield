import { Redis } from 'ioredis';
import { loadConfig, loadEnvFile } from '../src/infrastructure/config/env';
import { createLogger } from '../src/infrastructure/logging/logger';

loadEnvFile();

const config = loadConfig();
const logger = createLogger({
  level: 'info',
  pretty: true,
  name: 'load-test-runner',
});

const TARGET_URL = process.env.TARGET_URL ?? `http://127.0.0.1:${config.http.port}`;
const CONCURRENT_REQUESTS = Number(process.env.STAMPEDE_REQUESTS ?? 500);

type TestRunResult = {
  strategy: string;
  totalRequests: number;
  successful: number;
  failed: number;
  latenciesMs: number[];
  p50: number;
  p95: number;
  p99: number;
  max: number;
  dbQueriesRecorded: number;
  cacheHitsRecorded: number;
};

const calculateQuantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const parseMetrics = async (
  strategyLabel: string,
): Promise<{ dbQueries: number; cacheHits: number }> => {
  try {
    const res = await fetch(`${TARGET_URL}/metrics`);
    if (!res.ok) return { dbQueries: 0, cacheHits: 0 };
    const text = await res.text();

    const dbQueryMatch = new RegExp(`db_queries_total{strategy="${strategyLabel}"}\\s+(\\d+)`).exec(
      text,
    );
    const cacheHitMatch = new RegExp(
      `cache_hits_total{strategy="${strategyLabel}"}\\s+(\\d+)`,
    ).exec(text);

    return {
      dbQueries: dbQueryMatch ? Number(dbQueryMatch[1]) : 0,
      cacheHits: cacheHitMatch ? Number(cacheHitMatch[1]) : 0,
    };
  } catch {
    return { dbQueries: 0, cacheHits: 0 };
  }
};

const executeRun = async (
  strategy: string,
  strategyLabel: string,
  path: string,
): Promise<TestRunResult> => {
  logger.info(
    { strategy, targetUrl: `${TARGET_URL}${path}`, count: CONCURRENT_REQUESTS },
    'Starting benchmark burst',
  );

  const beforeMetrics = await parseMetrics(strategyLabel);
  const latenciesMs: number[] = [];
  let successful = 0;
  let failed = 0;

  const promises = Array.from({ length: CONCURRENT_REQUESTS }, async () => {
    const start = performance.now();
    try {
      const response = await fetch(`${TARGET_URL}${path}`);
      const duration = performance.now() - start;
      latenciesMs.push(duration);

      if (response.ok) {
        successful += 1;
      } else {
        failed += 1;
      }
    } catch {
      const duration = performance.now() - start;
      latenciesMs.push(duration);
      failed += 1;
    }
  });

  await Promise.all(promises);

  latenciesMs.sort((a, b) => a - b);
  const p50 = calculateQuantile(latenciesMs, 0.5);
  const p95 = calculateQuantile(latenciesMs, 0.95);
  const p99 = calculateQuantile(latenciesMs, 0.99);
  const max = latenciesMs[latenciesMs.length - 1] ?? 0;

  const afterMetrics = await parseMetrics(strategyLabel);
  const dbQueriesRecorded = Math.max(0, afterMetrics.dbQueries - beforeMetrics.dbQueries);
  const cacheHitsRecorded = Math.max(0, afterMetrics.cacheHits - beforeMetrics.cacheHits);

  return {
    strategy,
    totalRequests: CONCURRENT_REQUESTS,
    successful,
    failed,
    latenciesMs,
    p50,
    p95,
    p99,
    max,
    dbQueriesRecorded,
    cacheHitsRecorded,
  };
};

export const runStampedeSuite = async (): Promise<void> => {
  logger.info('=== Cache Stampede Benchmark Suite ===');

  try {
    const healthCheck = await fetch(`${TARGET_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error(`Target ${TARGET_URL} is unhealthy (HTTP ${healthCheck.status})`);
    }
  } catch (err) {
    logger.error(
      { err },
      `Unable to connect to target application at ${TARGET_URL}. Is it running?`,
    );
    return;
  }

  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
  });

  // 1. SWR (v3) - Prime cache then expire the freshness marker to simulate stale-while-revalidate
  logger.info('Setting up Stale-While-Revalidate test (freshness expired, stale data retained)...');
  await fetch(`${TARGET_URL}/api/v3/leaderboard?page=1`); // warm once
  await redis.del('leaderboard:v3:page:1:stale'); // expire freshness marker -> turns entry STALE!
  const v3Result = await executeRun(
    'Stale-While-Revalidate (v3)',
    'swr',
    '/api/v3/leaderboard?page=1',
  );

  // 2. Distributed Lock (v2) - Completely cold cache
  logger.info('Setting up Distributed Lock test (cold cache under stampede)...');
  await redis.del('leaderboard:v2:page:1:data', 'leaderboard:v2:page:1:stale');
  const v2Result = await executeRun('Distributed Lock (v2)', 'lock', '/api/v2/leaderboard?page=1');

  // 3. Naive TTL (v1) - Completely cold cache (stampede hits MySQL!)
  logger.info('Setting up Naive TTL test (cold cache under stampede)...');
  await redis.del('leaderboard:v1:page:1:data');
  const v1Result = await executeRun('Naive TTL (v1)', 'naive', '/api/v1/leaderboard?page=1');

  redis.disconnect();

  const formatSummary = (res: TestRunResult): string =>
    `| ${res.strategy.padEnd(28)} | ${String(res.dbQueriesRecorded).padStart(13)} | ${res.p50.toFixed(1).padStart(7)}ms | ${res.p95.toFixed(1).padStart(7)}ms | ${res.p99.toFixed(1).padStart(7)}ms | ${String(res.failed).padStart(6)} | ${String(res.cacheHitsRecorded).padStart(10)} |`;

  process.stdout.write(
    '\n======================================= BENCHMARK RESULTS =======================================\n',
  );
  process.stdout.write(
    '| Strategy                     | MySQL Queries |     p50   |     p95   |     p99   | Errors | Cache Hits |\n',
  );
  process.stdout.write(
    '|------------------------------|---------------|-----------|-----------|-----------|--------|------------|\n',
  );
  process.stdout.write(`${formatSummary(v1Result)}\n`);
  process.stdout.write(`${formatSummary(v2Result)}\n`);
  process.stdout.write(`${formatSummary(v3Result)}\n`);
  process.stdout.write(
    '=================================================================================================\n\n',
  );
};

if (process.argv[1]?.endsWith('run-stampede.ts')) {
  void runStampedeSuite();
}
