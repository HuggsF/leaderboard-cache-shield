# ADR 003: Exposing Three Caching Strategies for Comparative Benchmarking

## Status
Accepted

## Context
When engineering high-throughput backend services, engineers frequently debate between simple cache-aside TTLs, mutex locks (single-flight / distributed locks), and background revalidation patterns (SWR).

Theoretical explanations often fail to convey the catastrophic real-world impact of Cache Stampedes on relational databases. To demonstrate senior engineering leadership, this repository serves not only as a production-grade implementation but also as an empirical educational benchmark.

## Decision
We expose **three distinct strategies side-by-side** via versioned endpoints in the presentation layer:
- `GET /api/v1/leaderboard` — **Naive TTL (v1)**
- `GET /api/v2/leaderboard` — **Distributed Lock (v2)**
- `GET /api/v3/leaderboard` — **Stale-While-Revalidate (v3)**

All three endpoints share:
1. The exact same HTTP contract, input validation rules (Zod + Fastify), and domain entities.
2. The exact same MySQL database and heavy query simulation.
3. The exact same structured logger (Pino) and Prometheus metrics registry.

### Comparative Strategy Matrix

| Dimension | Naive TTL (v1) | Distributed Lock (v2) | Stale-While-Revalidate (v3) |
|---|---|---|---|
| **Cache Miss Behavior** | Every request queries MySQL | 1 request queries MySQL; others wait | Returns stale data immediately; 1 background query |
| **MySQL Query Load under 10k burst** | ~10,000 queries (stampede) | 1 query | 1 query |
| **p99 Client Latency** | Timeout / Crash (seconds) | ~500ms - 600ms (waits for MySQL) | ~5ms (immediate cache return) |
| **Availability Risk** | Extremely high (DB pool exhaustion) | Low | Near zero |
| **Data Freshness** | Strict (at cost of availability) | Strict | Eventual consistency |

## Consequences

### Positive
- **Empirical Proof**: Allows reproducible load testing with Artillery and Autocannon, demonstrating metrics live in Grafana or Prometheus.
- **Architectural Showcase**: Demonstrates Clean Architecture and Open-Closed Principle (OCP): the application layer hosts distinct Use Cases implementing the same domain ports without code duplication.
- **Decision Framework**: Provides teams with a concrete roadmap on when to use Lock vs SWR based on business freshness tolerance.

### Negative / Trade-offs
- Multiple use case implementations to maintain and test. Clean Architecture and shared service abstractions (`executeLeaderboardQuery`, `LockGuardedRefresher`) minimize duplication.
