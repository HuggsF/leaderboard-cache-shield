# ADR 002: Distributed Lock Algorithm (Redlock) and Cache Rebuild Concurrency

## Status
Accepted

## Context
When multiple Node.js application instances run behind a load balancer, multiple workers may encounter a cache miss or trigger a background revalidation for the same leaderboard page at the exact same moment.

Without coordination across process boundaries:
1. Every application instance might independently execute the ~500ms MySQL aggregation.
2. Even if an in-process mechanism (such as Single-Flight) deduplicates calls within a single Node.js event loop, it cannot synchronize across separate Node.js processes or container replicas.
3. Therefore, an inter-process synchronization primitive is required to coordinate cache warming and revalidation.

## Decision
We implement a **Distributed Lock** using **Redlock** backed by Redis.

### Architectural Classification: Efficiency Lock
In distributed systems design (Martin Kleppmann vs. Salvatore Sanfilippo debate), distributed locks generally fall into two categories:
1. **Correctness Locks**: A failure of mutual exclusion results in data corruption, split-brain, or financial loss (requires fencing tokens, strong linearizability, consensus protocols like Raft/Paxos/Zookeeper).
2. **Efficiency Locks**: Mutual exclusion avoids redundant expensive computations. If the lock temporarily fails, expires early, or is acquired twice during an edge-case network partition, the only consequence is an extra read query to MySQL and an idempotent write to Redis.

For leaderboard caching, the lock is strictly an **Efficiency Lock**. Leaderboard calculation from MySQL is a pure, idempotent read operation. Re-writing the calculated JSON payload into Redis is idempotent (`SET key value EX ttl`). Thus, Redlock provides the optimal balance of high performance, sub-millisecond acquisition latency, and strong practical mutual exclusion.

### Implementation Details
- **Acquisition Strategy**: `SET resource_name lock_id NX PX ttl_ms`.
- **Lock TTL**: Default 10,000ms (`LOCK_TTL_MS`), strictly higher than the worst-case query timeout (`LEADERBOARD_QUERY_DELAY_MS`) to prevent mid-query lease expiration.
- **Retry Mechanism**: 3 retry attempts with exponential backoff and jitter (`LOCK_RETRY_DELAY_MS = 200ms`, `LOCK_RETRY_JITTER_MS = 50ms`).
- **Connection Isolation**: Two dedicated Redis connections are established in the container: `leaderboard-cache` and `leaderboard-lock`. This ensures lock acquisition/release commands never queue behind megabytes of piped cache payloads.

## Consequences

### Positive
- **Guaranteed Single Worker**: Under heavy multi-instance load, only 1 instance computes the leaderboard and writes to Redis.
- **Fail-Safe Release**: Locks automatically expire via TTL if an instance crashes during query execution, preventing permanent deadlock.
- **Safe Release**: Lock releases check that the value matches the current holder's token before deleting (via Lua script in Redlock).

### Negative / Trade-offs
- **Latency for Lock Waiters (v2)**: In the synchronous lock strategy (v2), requests that do not win the lock must wait (polling Redis) until the winner finishes populating the cache. If timeout is reached, they fall back to stale data or 503.
- **Redis Dependency**: Redis availability is critical for distributed synchronization.
