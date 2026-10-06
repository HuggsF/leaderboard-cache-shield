import type { LatencySummary } from '@application/interfaces/metrics-collector';

/**
 * Sliding window over the last `capacity` latency samples: O(1) record (ring buffer), exact
 * quantiles computed on demand (sort of at most `capacity` numbers, at scrape time only).
 * `count` and `sumMs` are cumulative, as Prometheus summaries require.
 */
export class LatencyWindow {
  private readonly samples: Float64Array;
  private next = 0;
  private filled = 0;
  private total = 0;
  private sum = 0;

  constructor(readonly capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('LatencyWindow capacity must be a positive integer');
    }
    this.samples = new Float64Array(capacity);
  }

  record(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.samples[this.next] = durationMs;
    this.next = (this.next + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
    this.total += 1;
    this.sum += durationMs;
  }

  get count(): number {
    return this.total;
  }

  get sumMs(): number {
    return this.sum;
  }

  /** Nearest-rank quantiles over the window; NaN when nothing was recorded yet. */
  summary(): LatencySummary {
    const sorted = this.samples.slice(0, this.filled).sort();
    return {
      count: this.total,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      max: quantile(sorted, 1),
    };
  }
}

export const quantile = (sorted: Float64Array, q: number): number => {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
};
