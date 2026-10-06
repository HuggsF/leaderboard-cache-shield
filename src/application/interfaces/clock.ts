/** Time source. Injected so waits, timeouts and latencies are testable without real delays. */
export interface Clock {
  /** Wall-clock time, e.g. when a ranking was generated. */
  now(): Date;
  /** Monotonic milliseconds, for durations and deadlines (unaffected by NTP adjustments). */
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}
