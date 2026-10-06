import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';
import type {
  LatencyLabel,
  MetricsCollector,
  MetricsSnapshot,
} from '@application/interfaces/metrics-collector';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';
import { LatencyWindow } from './latency-window';

type CounterName =
  'cacheHits' | 'cacheMisses' | 'staleServed' | 'lockWaits' | 'dbQueries' | 'dbQueryErrors';

const COUNTERS: readonly { key: CounterName; name: string; help: string }[] = [
  {
    key: 'cacheHits',
    name: 'cache_hits_total',
    help: 'Requests answered from Redis on their first lookup (fresh or stale entry).',
  },
  {
    key: 'cacheMisses',
    name: 'cache_misses_total',
    help: 'Requests whose first lookup found no usable entry.',
  },
  {
    key: 'staleServed',
    name: 'stale_served_total',
    help: 'Responses served from a stale entry.',
  },
  {
    key: 'lockWaits',
    name: 'lock_waits_total',
    help: "Requests that lost the lock race and waited for another request's refresh.",
  },
  {
    key: 'dbQueries',
    name: 'db_queries_total',
    help: 'Heavy ranking queries sent to MySQL.',
  },
  {
    key: 'dbQueryErrors',
    name: 'db_query_errors_total',
    help: 'Heavy ranking queries that failed (including pool acquire timeouts).',
  },
];

const LATENCIES: readonly { label: LatencyLabel; name: string; help: string }[] = [
  {
    label: 'response',
    name: 'response_latency_seconds',
    help: 'Use-case latency (cache lookup, lock waits, query) over the last samples.',
  },
  {
    label: 'db_query',
    name: 'db_query_latency_seconds',
    help: 'Duration of the heavy MySQL query (pool wait included) over the last samples.',
  },
];

const QUANTILES = [
  { quantile: '0.5', pick: 'p50' },
  { quantile: '0.95', pick: 'p95' },
  { quantile: '0.99', pick: 'p99' },
] as const;

/** Collector bound to one strategy label. */
class ScopedMetricsCollector implements MetricsCollector {
  readonly counters: Record<CounterName, number> = {
    cacheHits: 0,
    cacheMisses: 0,
    staleServed: 0,
    lockWaits: 0,
    dbQueries: 0,
    dbQueryErrors: 0,
  };
  readonly latencies: Record<LatencyLabel, LatencyWindow>;

  constructor(windowSize: number) {
    this.latencies = {
      response: new LatencyWindow(windowSize),
      db_query: new LatencyWindow(windowSize),
    };
  }

  incrementCacheHit(): void {
    this.counters.cacheHits += 1;
  }

  incrementCacheMiss(): void {
    this.counters.cacheMisses += 1;
  }

  incrementStaleServed(): void {
    this.counters.staleServed += 1;
  }

  incrementLockWait(): void {
    this.counters.lockWaits += 1;
  }

  incrementDbQuery(): void {
    this.counters.dbQueries += 1;
  }

  incrementDbQueryError(): void {
    this.counters.dbQueryErrors += 1;
  }

  recordLatency(label: LatencyLabel, durationMs: number): void {
    this.latencies[label].record(durationMs);
  }

  /** Queries started and neither completed nor failed yet. */
  get dbQueriesInFlight(): number {
    return Math.max(
      0,
      this.counters.dbQueries - this.latencies.db_query.count - this.counters.dbQueryErrors,
    );
  }

  getMetrics(): MetricsSnapshot {
    return {
      ...this.counters,
      latency: {
        response: this.latencies.response.summary(),
        db_query: this.latencies.db_query.summary(),
      },
    };
  }
}

export type MetricsRegistryOptions = {
  /** Latency samples kept per strategy for the quantiles. */
  readonly windowSize?: number;
  /** Static labels published as `leaderboard_info{...} 1` (configuration of this instance). */
  readonly info?: Readonly<Record<string, string | number>>;
};

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const formatLabels = (labels: Readonly<Record<string, string | number>>): string => {
  const pairs = Object.entries(labels).map(
    ([name, value]) => `${name}="${escapeLabelValue(String(value))}"`,
  );
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
};

const formatValue = (value: number): string => (Number.isNaN(value) ? 'NaN' : String(value));

const NANOSECONDS_PER_SECOND = 1e9;

/**
 * In-house metrics: one collector per strategy behind the MetricsCollector port, rendered in
 * the Prometheus text exposition format (0.0.4). No client library needed for counters and
 * summaries, and the port's snapshot stays synchronous. See docs/adr/004-in-house-metrics.md.
 */
export class MetricsRegistry implements MetricsExporter {
  readonly contentType = 'text/plain; version=0.0.4; charset=utf-8';
  private readonly collectors = new Map<string, ScopedMetricsCollector>();
  private readonly eventLoopDelay: IntervalHistogram;
  private readonly windowSize: number;

  constructor(private readonly options: MetricsRegistryOptions = {}) {
    this.windowSize = options.windowSize ?? 10_000;
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
    this.eventLoopDelay.enable();
  }

  /** Returns the collector for a strategy, creating it (with zeroed series) on first use. */
  scope(strategy: string): MetricsCollector {
    return this.scoped(strategy);
  }

  render(): string {
    const lines: string[] = [];
    const series = [...this.collectors.entries()];

    if (this.options.info !== undefined) {
      lines.push(
        '# HELP leaderboard_info Configuration of this instance (labels); the value is always 1.',
        '# TYPE leaderboard_info gauge',
        `leaderboard_info${formatLabels(this.options.info)} 1`,
      );
    }

    for (const counter of COUNTERS) {
      lines.push(`# HELP ${counter.name} ${counter.help}`, `# TYPE ${counter.name} counter`);
      for (const [strategy, collector] of series) {
        lines.push(
          `${counter.name}${formatLabels({ strategy })} ${collector.counters[counter.key]}`,
        );
      }
    }

    lines.push(
      '# HELP db_queries_in_flight Heavy queries started and not finished yet (incl. waiting for a pool connection).',
      '# TYPE db_queries_in_flight gauge',
    );
    for (const [strategy, collector] of series) {
      lines.push(
        `db_queries_in_flight${formatLabels({ strategy })} ${collector.dbQueriesInFlight}`,
      );
    }

    for (const latency of LATENCIES) {
      lines.push(`# HELP ${latency.name} ${latency.help}`, `# TYPE ${latency.name} summary`);
      for (const [strategy, collector] of series) {
        const window = collector.latencies[latency.label];
        const summary = window.summary();
        for (const { quantile, pick } of QUANTILES) {
          lines.push(
            `${latency.name}${formatLabels({ strategy, quantile })} ${formatValue(summary[pick] / 1000)}`,
          );
        }
        lines.push(
          `${latency.name}_sum${formatLabels({ strategy })} ${window.sumMs / 1000}`,
          `${latency.name}_count${formatLabels({ strategy })} ${window.count}`,
        );
      }
    }

    lines.push(...this.renderRuntimeMetrics());
    return `${lines.join('\n')}\n`;
  }

  /** Stops the event-loop sampler (graceful shutdown, tests). */
  close(): void {
    this.eventLoopDelay.disable();
  }

  private scoped(strategy: string): ScopedMetricsCollector {
    let collector = this.collectors.get(strategy);
    if (collector === undefined) {
      collector = new ScopedMetricsCollector(this.windowSize);
      this.collectors.set(strategy, collector);
    }
    return collector;
  }

  /** Event-loop delay since the previous scrape, and memory usage. */
  private renderRuntimeMetrics(): string[] {
    const delay = this.eventLoopDelay;
    const hasSamples = delay.count > 0;
    const toSeconds = (nanoseconds: number): string =>
      hasSamples ? formatValue(nanoseconds / NANOSECONDS_PER_SECOND) : 'NaN';
    const lines = [
      '# HELP nodejs_eventloop_delay_seconds Event-loop delay since the previous scrape.',
      '# TYPE nodejs_eventloop_delay_seconds summary',
      `nodejs_eventloop_delay_seconds{quantile="0.5"} ${toSeconds(delay.percentile(50))}`,
      `nodejs_eventloop_delay_seconds{quantile="0.99"} ${toSeconds(delay.percentile(99))}`,
      `nodejs_eventloop_delay_seconds{quantile="1"} ${toSeconds(delay.max)}`,
    ];
    delay.reset();

    const memory = process.memoryUsage();
    lines.push(
      '# HELP process_resident_memory_bytes Resident set size.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memory.rss}`,
      '# HELP nodejs_heap_used_bytes V8 heap in use.',
      '# TYPE nodejs_heap_used_bytes gauge',
      `nodejs_heap_used_bytes ${memory.heapUsed}`,
    );
    return lines;
  }
}
