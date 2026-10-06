import { createLogger } from '../src/infrastructure/logging/logger';

const logger = createLogger({
  level: 'info',
  pretty: true,
  name: 'load-test-runner',
});

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:3000';
const CONCURRENT_REQUESTS = Number(process.env.STAMPEDE_REQUESTS ?? 1_000);

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
  dbQueriesRecorded?: number;
};

const calculateQuantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const executeRun = async (strategy: string, path: string): Promise<TestRunResult> => {
  logger.info(
    { strategy, targetUrl: `${TARGET_URL}${path}`, count: CONCURRENT_REQUESTS },
    'Starting benchmark run',
  );

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

  const v3Result = await executeRun('Stale-While-Revalidate (v3)', '/api/v3/leaderboard?page=1');
  const v2Result = await executeRun('Distributed Lock (v2)', '/api/v2/leaderboard?page=1');
  const v1Result = await executeRun('Naive TTL (v1)', '/api/v1/leaderboard?page=1');

  const formatSummary = (res: TestRunResult): string =>
    `| ${res.strategy.padEnd(28)} | ${String(res.successful).padStart(7)} | ${String(res.failed).padStart(6)} | ${res.p50.toFixed(1).padStart(7)}ms | ${res.p95.toFixed(1).padStart(7)}ms | ${res.p99.toFixed(1).padStart(7)}ms | ${res.max.toFixed(1).padStart(7)}ms |`;

  process.stdout.write(
    '\n============================== BENCHMARK RESULTS ==============================\n',
  );
  process.stdout.write(
    '| Strategy                     | Success | Errors |     p50   |     p95   |     p99   |     max   |\n',
  );
  process.stdout.write(
    '|------------------------------|---------|--------|-----------|-----------|-----------|-----------|\n',
  );
  process.stdout.write(`${formatSummary(v1Result)}\n`);
  process.stdout.write(`${formatSummary(v2Result)}\n`);
  process.stdout.write(`${formatSummary(v3Result)}\n`);
  process.stdout.write(
    '===============================================================================\n\n',
  );
};

if (process.argv[1]?.endsWith('run-stampede.ts')) {
  void runStampedeSuite();
}
