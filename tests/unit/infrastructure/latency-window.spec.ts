import { LatencyWindow, quantile } from '@infrastructure/metrics/latency-window';

describe('LatencyWindow', () => {
  it('throws on invalid capacity', () => {
    expect(() => new LatencyWindow(0)).toThrow(RangeError);
    expect(() => new LatencyWindow(-5)).toThrow(RangeError);
    expect(() => new LatencyWindow(1.5)).toThrow(RangeError);
  });

  it('records valid samples and ignores negative/non-finite samples', () => {
    const window = new LatencyWindow(5);
    window.record(10);
    window.record(20);
    window.record(-5);
    window.record(Number.NaN);
    window.record(Number.POSITIVE_INFINITY);

    expect(window.count).toBe(2);
    expect(window.sumMs).toBe(30);
  });

  it('computes nearest-rank quantiles correctly', () => {
    const window = new LatencyWindow(10);
    for (let i = 1; i <= 100; i += 1) {
      window.record(i);
    }

    const summary = window.summary();
    expect(summary.count).toBe(100);
    expect(summary.p50).toBeGreaterThanOrEqual(91);
    expect(summary.p99).toBe(100);
    expect(summary.max).toBe(100);
  });

  it('returns NaN quantiles when empty', () => {
    const window = new LatencyWindow(5);
    const summary = window.summary();
    expect(Number.isNaN(summary.p50)).toBe(true);
    expect(Number.isNaN(summary.p95)).toBe(true);
    expect(Number.isNaN(summary.p99)).toBe(true);
    expect(Number.isNaN(summary.max)).toBe(true);
    expect(Number.isNaN(quantile(new Float64Array(0), 0.5))).toBe(true);
  });
});
