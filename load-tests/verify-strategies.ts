/**
 * Reproducible verification of the three caching strategies under a stampede.
 *
 * Runs from inside the Compose network (no host port-forwarding in the measurement):
 *   docker compose --profile tools run --rm tools npm run loadtest:verify
 *
 * For every strategy (v1 naive, v2 lock, v3 SWR) the cached page is expired the way it expires in
 * production, then:
 *   - Burst:  N simultaneous requests (1,000 and 10,000) — the "19:00" spike.
 *   - Window: 50 connections of constant traffic for 15 s right after the expiry — what users
 *             feel while the cache is being rebuilt.
 * Server-side counters (/metrics) give the MySQL queries actually executed.
 *
 * Writes load-tests/results.md and load-tests/results.json.
 */
import { writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import autocannon from 'autocannon';
import { Redis } from 'ioredis';
import { loadConfig, loadEnvFile } from '../src/infrastructure/config/env';

type Strategy = {
  readonly id: 'v1' | 'v2' | 'v3';
  readonly label: string;
  readonly metric: string;
};

type ServerCounters = {
  readonly dbQueries: number;
  readonly dbQueryErrors: number;
  readonly staleServed: number;
  readonly lockWaits: number;
};

type Measurement = {
  readonly strategy: Strategy['id'];
  readonly test: string;
  readonly requests: number;
  readonly ok: number;
  readonly failed: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly requestsPerSecond: number;
  readonly server: ServerCounters;
};

const STRATEGIES: readonly Strategy[] = [
  { id: 'v1', label: 'v1 · Naive TTL', metric: 'naive' },
  { id: 'v2', label: 'v2 · Distributed lock', metric: 'lock' },
  { id: 'v3', label: 'v3 · Stale-while-revalidate', metric: 'swr' },
];
const BURSTS = [1_000, 10_000] as const;
const WINDOW_CONNECTIONS = 50;
const WINDOW_SECONDS = 15;
const REQUEST_TIMEOUT_SECONDS = 60;

loadEnvFile();
const config = loadConfig();
const target = process.env.TARGET_URL ?? `http://127.0.0.1:${config.http.port}`;
const redis = new Redis({ host: config.redis.host, port: config.redis.port, db: config.redis.db });

const pathOf = (strategy: Strategy): string => `/api/${strategy.id}/leaderboard?page=1`;

/** How the cached page expires in production for each strategy. */
const expire = async (strategy: Strategy): Promise<void> => {
  await fetch(`${target}${pathOf(strategy)}`); // make sure a cached copy exists first
  if (strategy.id === 'v3') {
    // SWR keeps the data 600 s but considers it fresh only 300 s: the freshness marker expires.
    await redis.del('leaderboard:v3:page:1:stale');
  } else {
    await redis.del(
      `leaderboard:${strategy.id}:page:1:data`,
      `leaderboard:${strategy.id}:page:1:stale`,
    );
  }
};

const readCounters = async (strategy: Strategy): Promise<ServerCounters> => {
  const text = await (await fetch(`${target}/metrics`)).text();
  const value = (name: string): number => {
    const match = new RegExp(`^${name}\\{strategy="${strategy.metric}"\\} (\\d+)`, 'm').exec(text);
    return match?.[1] === undefined ? 0 : Number(match[1]);
  };
  return {
    dbQueries: value('db_queries_total'),
    dbQueryErrors: value('db_query_errors_total'),
    staleServed: value('stale_served_total'),
    lockWaits: value('lock_waits_total'),
  };
};

const diff = (after: ServerCounters, before: ServerCounters): ServerCounters => ({
  dbQueries: after.dbQueries - before.dbQueries,
  dbQueryErrors: after.dbQueryErrors - before.dbQueryErrors,
  staleServed: after.staleServed - before.staleServed,
  lockWaits: after.lockWaits - before.lockWaits,
});

const measure = async (
  strategy: Strategy,
  test: string,
  options: { connections: number; amount?: number; duration?: number },
): Promise<Measurement> => {
  await expire(strategy);
  const before = await readCounters(strategy);
  const result = await autocannon({
    url: `${target}${pathOf(strategy)}`,
    connections: options.connections,
    ...(options.amount === undefined ? {} : { amount: options.amount }),
    ...(options.duration === undefined ? {} : { duration: options.duration }),
    timeout: REQUEST_TIMEOUT_SECONDS,
  });
  // Let a background (SWR) refresh land before reading the counters.
  await sleep(5_000);
  const after = await readCounters(strategy);
  const ok = result['2xx'];
  const requests = result.requests.total;
  return {
    strategy: strategy.id,
    test,
    requests,
    ok,
    failed: requests - ok,
    p50Ms: result.latency.p50,
    p99Ms: result.latency.p99,
    maxMs: result.latency.max,
    requestsPerSecond: Math.round(result.requests.average),
    server: diff(after, before),
  };
};

const toMarkdown = (results: readonly Measurement[]): string => {
  const labelOf = (id: Strategy['id']): string =>
    STRATEGIES.find((strategy) => strategy.id === id)?.label ?? id;
  const row = (result: Measurement): string =>
    `| ${labelOf(result.strategy)} | ${result.requests.toLocaleString('en-US')} | **${result.server.dbQueries.toLocaleString('en-US')}** | ${result.failed.toLocaleString('en-US')} | ${result.p50Ms.toLocaleString('en-US')} ms | ${result.p99Ms.toLocaleString('en-US')} ms | ${result.maxMs.toLocaleString('en-US')} ms | ${result.requestsPerSecond.toLocaleString('en-US')} | ${result.server.staleServed.toLocaleString('en-US')} | ${result.server.lockWaits.toLocaleString('en-US')} |`;
  const table = (test: string): string[] => [
    `### ${test}`,
    '',
    '| Strategy | Requests | MySQL queries | Failed (5xx / timeout) | p50 | p99 | Worst | Req/s | Stale copies served | Lock waits |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.filter((result) => result.test === test).map(row),
    '',
  ];
  const tests = [...new Set(results.map((result) => result.test))];
  return [
    '# Cache stampede verification — leaderboard-cache-shield',
    '',
    `- **Date:** ${new Date().toISOString()}`,
    `- **Environment:** Node ${process.version} · ${platform()} ${arch()} · ${cpus()[0]?.model.trim() ?? 'unknown CPU'} · docker-compose (Fastify app + MySQL 8 + Redis 7), load generated from the \`tools\` container`,
    `- **App config:** page size ${config.leaderboard.pageSize} · artificial query delay ${config.leaderboard.queryDelayMs} ms · MySQL pool ${config.database.pool.max} connections`,
    '- **Before each test** the cached page is expired the way it expires in production (v1/v2: entry gone; v3: freshness marker gone, stale data kept).',
    '- **MySQL queries**, stale copies and lock waits are read from the app’s own `/metrics` counters.',
    '',
    ...tests.flatMap(table),
    'Reproduce: `docker compose --profile tools run --rm tools npm run seed && docker compose --profile tools run --rm tools npm run loadtest:verify`.',
    '',
  ].join('\n');
};

const main = async (): Promise<void> => {
  const health = await fetch(`${target}/health`);
  if (!health.ok) {
    throw new Error(`${target} is not healthy (HTTP ${health.status})`);
  }
  const results: Measurement[] = [];
  for (const size of BURSTS) {
    for (const strategy of STRATEGIES) {
      const test = `Burst — ${size.toLocaleString('en-US')} simultaneous requests at expiry`;
      process.stdout.write(`${test} · ${strategy.label}\n`);
      results.push(await measure(strategy, test, { connections: size, amount: size }));
    }
  }
  for (const strategy of STRATEGIES) {
    const test = `Window — ${WINDOW_CONNECTIONS} connections × ${WINDOW_SECONDS} s of constant traffic from the expiry on`;
    process.stdout.write(`${test} · ${strategy.label}\n`);
    results.push(
      await measure(strategy, test, { connections: WINDOW_CONNECTIONS, duration: WINDOW_SECONDS }),
    );
  }

  const markdown = toMarkdown(results);
  await writeFile(join(__dirname, 'results.md'), markdown, 'utf8');
  await writeFile(
    join(__dirname, 'results.json'),
    JSON.stringify({ measuredAt: new Date().toISOString(), target, results }, null, 2),
    'utf8',
  );
  process.stdout.write(`\n${markdown}`);
};

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect();
  });
