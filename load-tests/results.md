# Cache stampede verification — leaderboard-cache-shield

- **Date:** 2026-10-06T17:09:12.577Z
- **Environment:** Node v24.21.0 · linux x64 · 13th Gen Intel(R) Core(TM) i5-13450HX · docker-compose (Fastify app + MySQL 8 + Redis 7), load generated from the `tools` container
- **App config:** page size 50 · artificial query delay 500 ms · MySQL pool 10 connections
- **Before each test** the cached page is expired the way it expires in production (v1/v2: entry gone; v3: freshness marker gone, stale data kept).
- **MySQL queries**, stale copies and lock waits are read from the app’s own `/metrics` counters.

### Burst — 1,000 simultaneous requests at expiry

| Strategy | Requests | MySQL queries | Failed (5xx / timeout) | p50 | p99 | Worst | Req/s | Stale copies served | Lock waits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 · Naive TTL | 1,000 | **1,000** | 980 | 11,520 ms | 12,072 ms | 16,591 ms | 59 | 0 | 0 |
| v2 · Distributed lock | 1,000 | **1** | 0 | 4,543 ms | 4,739 ms | 4,748 ms | 200 | 0 | 999 |
| v3 · Stale-while-revalidate | 1,000 | **1** | 0 | 453 ms | 468 ms | 472 ms | 1,000 | 1,000 | 0 |

### Burst — 10,000 simultaneous requests at expiry

| Strategy | Requests | MySQL queries | Failed (5xx / timeout) | p50 | p99 | Worst | Req/s | Stale copies served | Lock waits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 · Naive TTL | 10,000 | **10,000** | 9,980 | 15,670 ms | 17,709 ms | 18,595 ms | 556 | 0 | 0 |
| v2 · Distributed lock | 10,000 | **1** | 6,395 | 7,364 ms | 8,812 ms | 8,859 ms | 1,111 | 0 | 8,393 |
| v3 · Stale-while-revalidate | 10,000 | **1** | 0 | 2,086 ms | 3,350 ms | 3,383 ms | 2,500 | 9,730 | 0 |

### Window — 50 connections × 15 s of constant traffic from the expiry on

| Strategy | Requests | MySQL queries | Failed (5xx / timeout) | p50 | p99 | Worst | Req/s | Stale copies served | Lock waits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 · Naive TTL | 19,012 | **50** | 30 | 10 ms | 73 ms | 13,236 ms | 1,268 | 0 | 0 |
| v2 · Distributed lock | 70,206 | **1** | 0 | 7 ms | 23 ms | 2,915 ms | 4,681 | 0 | 49 |
| v3 · Stale-while-revalidate | 64,296 | **1** | 0 | 10 ms | 28 ms | 65 ms | 4,287 | 11,698 | 0 |

Reproduce: `docker compose --profile tools run --rm tools npm run seed && docker compose --profile tools run --rm tools npm run loadtest:verify`.
