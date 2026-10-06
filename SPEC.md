# SPEC.md — leaderboard-cache-shield

## Overview

| Field | Value |
|---|---|
| **Project** | leaderboard-cache-shield |
| **Problem** | Prevent Cache Stampede when 10,000 concurrent users hit the same endpoint |
| **Interview Question** | Q9 — DOT Digital Group Senior Backend Node.js |
| **Architecture** | Clean Architecture + DDD + TypeScript |

## Problem Statement

An e-learning platform has 10,000 students that open the home screen at exactly 19:00. The screen fetches a "Student Ranking" that requires a heavy MySQL query (JOINs, aggregations, sorting). When the Redis cache expires (TTL), all 10,000 requests simultaneously hit MySQL, causing it to crash. This is called **Cache Stampede**.

## Solution

Implement three caching strategies (naive TTL, distributed lock, stale-while-revalidate) and benchmark them under load to demonstrate the stampede problem and its solutions.

---

## Domain Model

### Entities

#### LeaderboardEntry
```typescript
class LeaderboardEntry {
  readonly studentId: string
  readonly studentName: StudentName
  readonly courseName: CourseName
  readonly totalScore: Score
  readonly rank: Rank
  readonly completedCourses: number

  static create(props: LeaderboardEntryProps): Result<LeaderboardEntry, DomainError>
}
```

#### Leaderboard
```typescript
class Leaderboard {
  readonly entries: LeaderboardEntry[]
  readonly generatedAt: Date
  readonly totalStudents: number
  readonly pageSize: number
  readonly currentPage: number

  static create(props: LeaderboardProps): Result<Leaderboard, DomainError>
  isStale(maxAgeMs: number): boolean
}
```

### Value Objects
- **Score**: 0-10000, integer
- **Rank**: positive integer
- **StudentName**: 2-100 chars
- **CourseName**: 2-200 chars

### Repository Interfaces

```typescript
interface LeaderboardRepository {
  getLeaderboard(page: number, pageSize: number): Promise<Leaderboard>
}
```

### Application Interfaces

```typescript
interface CacheProvider {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
  getWithStaleSupport<T>(key: string): Promise<{ data: T | null; isStale: boolean }>
  setWithStaleSupport<T>(key: string, value: T, freshTtl: number, staleTtl: number): Promise<void>
}

interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<string | null>
  release(key: string, lockId: string): Promise<boolean>
}

interface MetricsCollector {
  incrementCacheHit(): void
  incrementCacheMiss(): void
  incrementDbQuery(): void
  recordLatency(label: string, durationMs: number): void
  getMetrics(): Metrics
}
```

---

## Application Layer

### Use Cases

#### GetLeaderboardNaiveUseCase
Simple TTL cache — demonstrates the stampede problem.
1. Check Redis cache
2. Cache hit → return data
3. Cache miss → query MySQL → set cache with TTL → return data
**Problem**: All 10k requests see cache miss simultaneously.

#### GetLeaderboardWithLockUseCase
Distributed lock prevents stampede.
1. Check Redis cache
2. Cache hit → return data
3. Cache miss → try to acquire distributed lock
4. Lock acquired → query MySQL → update cache → release lock → return data
5. Lock not acquired → wait briefly → return stale data or retry

#### GetLeaderboardSWRUseCase (Stale-While-Revalidate)
Best strategy — serves stale data while refreshing.
1. Check Redis cache (with stale support)
2. Data is fresh → return immediately
3. Data is stale → return stale data immediately + trigger async background refresh
4. No data at all → query MySQL → set cache → return data

---

## Infrastructure Layer

### Redis Setup
- **ioredis** client
- Separate key patterns:
  - `leaderboard:page:{n}:data` — cached data
  - `leaderboard:page:{n}:stale` — stale flag (for SWR)
  - `leaderboard:page:{n}:lock` — distributed lock
- TTL: 300s fresh, 600s stale

### Distributed Lock (Redlock)
- Uses `redlock` library
- Lock TTL: 10 seconds
- Retry: 3 attempts with 200ms delay

### MySQL
- Heavy query with JOINs + aggregations:
```sql
SELECT s.id, s.name, SUM(e.score) as total_score,
       COUNT(e.course_id) as completed_courses,
       RANK() OVER (ORDER BY SUM(e.score) DESC) as rank
FROM students s
JOIN enrollments e ON s.id = e.student_id
WHERE e.completed = true
GROUP BY s.id
ORDER BY total_score DESC
LIMIT ? OFFSET ?
```
- Add artificial `SLEEP(0.5)` to simulate heavy query (~500ms)

### Metrics
- Prometheus-style metrics exported at `/metrics`
- Tracked: cache_hits, cache_misses, db_queries, response_latency_p99

---

## Presentation Layer

### HTTP API
```
GET /api/v1/leaderboard?page=1       # Naive TTL (stampede risk!)
GET /api/v2/leaderboard?page=1       # Distributed Lock
GET /api/v3/leaderboard?page=1       # Stale-While-Revalidate
GET /metrics                          # Prometheus metrics
GET /health                           # Health check
```

---

## Load Testing

### Artillery Config
Three test scenarios in `load-tests/`:
1. `stampede-naive.yml` — 10,000 requests in 1 second to `/api/v1/leaderboard`
2. `stampede-lock.yml` — 10,000 requests in 1 second to `/api/v2/leaderboard`
3. `stampede-swr.yml` — 10,000 requests in 1 second to `/api/v3/leaderboard`

### Expected Results Table (for README)

| Metric | Naive (v1) | Lock (v2) | SWR (v3) |
|---|---|---|---|
| MySQL queries | ~10,000 | 1 | 1 |
| p99 latency | timeout | ~600ms | ~5ms |
| Errors (5xx) | many | 0 | 0 |
| Cache hits | 0 (all miss) | ~9,999 | ~9,999 |

---

## Docker Compose

```yaml
services:
  mysql:
    image: mysql:8
    ports: ["3306:3306"]
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: leaderboard

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  app:
    build: .
    ports: ["3000:3000"]
    depends_on: [mysql, redis]
    environment:
      - DB_HOST=mysql
      - REDIS_HOST=redis
```

---

## Dependencies

### Production
- fastify, ioredis, redlock, mysql2, knex, pino, zod, dotenv, uuid

### Development
- typescript, tsx, jest, ts-jest, artillery, @types/node, eslint, prettier, testcontainers

---

## Seed Script
`scripts/seed.ts`:
- Creates 100,000 students with @faker-js/faker
- Creates 500,000 enrollments with random scores
- Creates indexes for query optimization

---

## ADR Documents

1. `docs/adr/001-swr-over-simple-ttl.md` — Why SWR is superior to simple TTL for high-concurrency
2. `docs/adr/002-distributed-lock-algorithm.md` — Why Redlock and its trade-offs
3. `docs/adr/003-three-strategy-comparison.md` — Why exposing all three strategies for educational purposes
