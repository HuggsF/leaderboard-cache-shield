export type FlightTicket<T> = {
  readonly promise: Promise<T>;
  /** True when the caller joined a flight started by someone else. */
  readonly shared: boolean;
};

/**
 * In-process request coalescing: concurrent callers asking for the same key share one
 * execution of `task` instead of starting their own. Also used to track background work so
 * it can be drained on shutdown.
 */
export class SingleFlight<T> {
  private readonly flights = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): FlightTicket<T> {
    const existing = this.flights.get(key);
    if (existing !== undefined) {
      return { promise: existing, shared: true };
    }
    // `then(task)` defers the task by one microtask, so the flight is registered before it can
    // settle — even when `task` throws synchronously.
    const promise: Promise<T> = Promise.resolve()
      .then(task)
      .finally(() => {
        if (this.flights.get(key) === promise) {
          this.flights.delete(key);
        }
      });
    this.flights.set(key, promise);
    return { promise, shared: false };
  }

  get size(): number {
    return this.flights.size;
  }

  /** Resolves once every flight (including ones started meanwhile) has settled. */
  async drain(): Promise<void> {
    while (this.flights.size > 0) {
      await Promise.allSettled([...this.flights.values()]);
    }
  }
}
