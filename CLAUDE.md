# CLAUDE.md — leaderboard-cache-shield

## Project Context
This project demonstrates Cache Stampede prevention using three strategies: naive TTL (the problem), distributed lock, and stale-while-revalidate. It benchmarks all three under 10,000 concurrent requests to show the difference.

## Key Constraints
- MUST use Fastify (not Express) for better performance under load
- MUST use ioredis for Redis client
- MUST use redlock for distributed locking
- MUST implement THREE separate strategies as v1/v2/v3 endpoints
- MUST include Artillery load test configs for each strategy
- MUST seed 100,000 students with a heavy JOIN query
- MUST track metrics (cache hits/misses, db queries, latency)
- The heavy query should take ~500ms (add SLEEP or complex JOINs)

## Implementation Order
1. Domain: LeaderboardEntry, Leaderboard entities, value objects
2. Domain: repository and cache interfaces (ports)
3. Application: GetLeaderboardNaiveUseCase (v1)
4. Application: GetLeaderboardWithLockUseCase (v2)
5. Application: GetLeaderboardSWRUseCase (v3)
6. Application: MetricsCollector interface
7. Infrastructure: MySQL leaderboard repository (heavy query)
8. Infrastructure: Redis cache provider (ioredis)
9. Infrastructure: Distributed lock (redlock)
10. Infrastructure: Metrics collector (prometheus-style)
11. Presentation: Fastify routes (v1, v2, v3, /metrics, /health)
12. Scripts: Seed 100k students
13. Load tests: Artillery configs
14. Tests: unit -> integration
15. Docker Compose

## Project-Specific Dependencies
- fastify, ioredis, redlock, mysql2, knex, uuid
- artillery (dev)

## Database Schema
```sql
CREATE TABLE students (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE courses (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL
);

CREATE TABLE enrollments (
  id VARCHAR(36) PRIMARY KEY,
  student_id VARCHAR(36) NOT NULL,
  course_id VARCHAR(36) NOT NULL,
  score INT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id) REFERENCES courses(id),
  INDEX idx_student (student_id),
  INDEX idx_completed (completed)
);
```
