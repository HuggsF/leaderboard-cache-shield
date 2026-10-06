# ADR 001: Stale-While-Revalidate (SWR) over Simple TTL for High-Concurrency Read Endpoints

## Status
Accepted

## Context
In our e-learning platform, the home leaderboard endpoint experiences massive concurrency spikes (up to 10,000 students opening the dashboard at peak hours, such as 19:00). The leaderboard query is computationally expensive: it performs multi-table JOINs (`students`, `enrollments`, `courses`), group aggregations (`SUM(score)`, `COUNT(completed_courses)`), window functions (`RANK() OVER (...)`), and sorts across hundreds of thousands of rows. Even with database indexing, this query incurs an execution latency of ~500ms.

Under a traditional **Naive TTL Cache-Aside** pattern:
1. The cache key `leaderboard:page:1` expires at time $T$.
2. Between time $T$ and $T + 500\text{ms}$, 10,000 incoming requests simultaneously encounter a cache miss.
3. All 10,000 requests trigger identical heavy queries against MySQL.
4. The database connection pool is immediately exhausted, query queues overflow, MySQL CPU spikes to 100%, and incoming requests fail with 5xx timeouts. This phenomenon is known as **Cache Stampede** (or Thundering Herd).

## Decision
We adopt the **Stale-While-Revalidate (SWR)** caching strategy (RFC 5861 pattern) as the primary caching pattern for high-traffic read models.

Under SWR:
1. Two separate TTL boundaries are maintained in Redis:
   - **Fresh TTL** (`CACHE_FRESH_TTL_SECONDS = 300s`): Managed via an auxiliary staleness marker key (`{entry}:stale`).
   - **Stale TTL** (`CACHE_STALE_TTL_SECONDS = 600s`): The total retention time of the payload in Redis (`{entry}:data`).
2. An atomic `MGET` queries both keys in a single network round-trip.
3. If the data exists and the stale marker is present, the data is **Fresh** and returned immediately (one Redis round-trip).
4. If the data exists but the marker has expired, the data is **Stale**:
   - The stale data is **returned immediately** to the client — nobody waits for MySQL (measured worst request: 65 ms under 50 concurrent connections across an expiry, vs 2.9 s with the distributed lock; see `load-tests/results.md`).
   - An asynchronous background revalidation task is triggered.
   - The background revalidation is guarded by an in-process **Single-Flight** promise deduplicator and a **Distributed Lock** across cluster nodes, ensuring that **only ONE** background query hits MySQL.
5. Once the background worker refreshes MySQL data and updates Redis, both the payload and the freshness marker are reset atomically via a Redis `MULTI` transaction.

## Consequences

### Positive
- **Near-Zero Latency Under Stampedes**: During cache expiration, 9,999 out of 10,000 users receive an instantaneous response ($\approx 5\text{ms}$) instead of waiting 500ms or timing out.
- **Database Shielding**: Exactly 1 query hits MySQL to recompute the leaderboard instead of 10,000 concurrent queries.
- **Graceful Degradation**: If MySQL experiences temporary slowness or failure, users continue to receive stale data safely without errors.

### Negative / Trade-offs
- **Eventual Consistency**: Users may view data that is up to several seconds behind real-time during the revalidation window. For a global student leaderboard, this trade-off is completely acceptable.
- **Storage Overhead**: Redis stores an additional key for the staleness marker (`{entry}:stale`), which introduces negligible memory overhead.
