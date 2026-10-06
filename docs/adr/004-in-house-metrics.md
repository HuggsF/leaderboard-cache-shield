# ADR 004: In-House Zero-Dependency Prometheus Metrics Registry

## Status
Accepted

## Context
High-concurrency systems (handling 10,000+ requests per second) require real-time observability over cache hits, misses, stale servings, database query latencies, and event-loop lag.

While `prom-client` is a popular Node.js library for Prometheus metrics, introducing heavy third-party metric collectors on the critical request path can introduce memory allocation churn, event-loop micro-delays, and complex configuration surfaces. Furthermore, the application's Domain and Application layers must remain decoupled from specific monitoring vendor SDKs via a clean `MetricsCollector` port.

## Decision
We implement a lightweight, zero-dependency `MetricsRegistry` in `src/infrastructure/metrics/metrics-registry.ts` paired with a sliding ring-buffer `LatencyWindow` (`latency-window.ts`) that outputs standard Prometheus text exposition format (version 0.0.4) at `GET /metrics`.

Key implementation highlights:
1. **Bounded Memory Ring Buffer**: `LatencyWindow` uses typed arrays (`Float64Array`) with fixed capacity (default 10,000 samples) to store latencies with $O(1)$ recording time and zero Garbage Collection allocations on the hot path.
2. **On-Demand Quantile Calculation**: Quantiles ($p50, p95, p99, \max$) are computed lazily only during scrape time (`GET /metrics`), eliminating CPU overhead during request processing.
3. **Event Loop Monitoring**: Integrates native Node.js `monitorEventLoopDelay({ resolution: 10 })` from `node:perf_hooks` and process memory stats (`rss`, `heapUsed`).
4. **Port & Adapter Isolation**: The application core interacts exclusively with the synchronous `MetricsCollector` interface, ensuring zero observability leak into business logic.

## Consequences

### Positive
- **Extreme Performance**: Ultra-fast counter increments and latency recording without external dependencies.
- **Full Prometheus Compatibility**: Scrapeable by standard Prometheus, Grafana Agent, or Datadog OpenMetrics integrators.
- **Predictable Memory Footprint**: Fixed-size circular buffers prevent out-of-memory errors regardless of traffic volume.

### Negative / Trade-offs
- Features like multi-dimensional dynamic label explosion are intentionally omitted to preserve bounded memory predictability.
