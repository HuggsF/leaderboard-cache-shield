# 🛡️ leaderboard-cache-shield

> Preventing Cache Stampede when 10,000 users hit the same endpoint simultaneously.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## 🎯 The Problem

**Cache Stampede** (aka Thundering Herd): When a cache key expires and thousands of concurrent requests all see the cache miss simultaneously, they ALL query the database at the same time.

```
19:00:00 — TTL expires
  Request 1   → cache MISS → SELECT ... FROM MySQL  ─┐
  Request 2   → cache MISS → SELECT ... FROM MySQL   │
  Request 3   → cache MISS → SELECT ... FROM MySQL   ├─ 10,000 identical queries
  ...                                                  │
  Request 10k → cache MISS → SELECT ... FROM MySQL  ─┘
                                                    💥 MySQL crashes
```

## 💡 Three Solutions Compared

This project implements **three caching strategies** side by side and benchmarks them under 10,000 concurrent requests:

| Strategy | MySQL Queries | p99 Latency | Errors |
|---|---|---|---|
| **v1: Naive TTL** | ~10,000 | timeout | Many (5xx) |
| **v2: Distributed Lock** | 1 | ~600ms | 0 |
| **v3: Stale-While-Revalidate** | 1 | ~5ms | 0 |

### How SWR Works

```
19:00:00 — TTL expires (data becomes "stale")
  Request 1   → stale data → return immediately (5ms) + trigger background refresh
  Request 2   → stale data → return immediately (5ms)
  ...
  Request 10k → stale data → return immediately (5ms)
  Background  → 1 query to MySQL → update cache
19:00:01 — All new requests get fresh data
```

## 🏗️ Architecture

**Clean Architecture + DDD + TypeScript**

```
src/
├── domain/           # LeaderboardEntry, Leaderboard entities, Ports
├── application/      # 3 use cases (Naive, Lock, SWR), Metrics interface
├── infrastructure/   # Redis (ioredis), Redlock, MySQL, Prometheus metrics
└── presentation/     # Fastify routes (v1, v2, v3), /metrics endpoint
```

### Key Technical Decisions

| Decision | Rationale | ADR |
|---|---|---|
| SWR as primary strategy | Returns stale data instantly (5ms). Zero downtime for users | [ADR-001](docs/adr/001-swr-over-simple-ttl.md) |
| Redlock for distributed locking | Correct distributed lock algorithm for Redis | [ADR-002](docs/adr/002-distributed-lock-algorithm.md) |
| Three strategies exposed | Educational comparison — shows the problem and solutions | [ADR-003](docs/adr/003-three-strategy-comparison.md) |

## 🚀 Quick Start

```bash
# Start MySQL + Redis
docker-compose up -d

# Install, migrate, seed 100k students
npm install && npm run migrate && npm run seed

# Start the server
npm run dev

# Run load tests
npm run loadtest:naive   # Watch MySQL crash with v1
npm run loadtest:lock    # See lock protection with v2
npm run loadtest:swr     # See instant responses with v3
```

## 📊 Metrics

Access `/metrics` for Prometheus-format metrics:
- `cache_hits_total` — number of cache hits
- `cache_misses_total` — number of cache misses
- `db_queries_total` — number of MySQL queries executed
- `response_latency_seconds` — response time histogram

## 📚 Tech Stack

| Technology | Role |
|---|---|
| **Fastify** | HTTP framework (high performance) |
| **ioredis** | Redis client |
| **redlock** | Distributed locking |
| **MySQL 8** | Database |
| **Artillery** | Load testing |
| **pino** | Structured logging |

## 📄 License

MIT
