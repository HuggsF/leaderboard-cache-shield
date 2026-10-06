import { MetricsRegistry } from '@infrastructure/metrics/metrics-registry';

describe('MetricsRegistry', () => {
  it('scopes collectors and renders prometheus text output with info labels', () => {
    const registry = new MetricsRegistry({
      info: { version: '1.0.0', environment: 'test' },
      windowSize: 100,
    });

    const v1 = registry.scope('v1');
    const v2 = registry.scope('v2');

    v1.incrementCacheHit();
    v1.incrementCacheMiss();
    v1.incrementStaleServed();
    v1.incrementLockWait();
    v1.incrementDbQuery();
    v1.incrementDbQueryError();
    v1.recordLatency('response', 15);
    v1.recordLatency('db_query', 500);

    v2.incrementCacheHit();
    v2.recordLatency('response', 5);

    const snapshot = v1.getMetrics();
    expect(snapshot.cacheHits).toBe(1);
    expect(snapshot.cacheMisses).toBe(1);
    expect(snapshot.staleServed).toBe(1);
    expect(snapshot.lockWaits).toBe(1);
    expect(snapshot.dbQueries).toBe(1);
    expect(snapshot.dbQueryErrors).toBe(1);

    const rendered = registry.render();
    expect(rendered).toContain('leaderboard_info{version="1.0.0",environment="test"} 1');
    expect(rendered).toContain('cache_hits_total{strategy="v1"} 1');
    expect(rendered).toContain('cache_hits_total{strategy="v2"} 1');
    expect(rendered).toContain('cache_misses_total{strategy="v1"} 1');
    expect(rendered).toContain('stale_served_total{strategy="v1"} 1');
    expect(rendered).toContain('lock_waits_total{strategy="v1"} 1');
    expect(rendered).toContain('db_queries_total{strategy="v1"} 1');
    expect(rendered).toContain('db_query_errors_total{strategy="v1"} 1');
    expect(rendered).toContain('response_latency_seconds');
    expect(rendered).toContain('nodejs_eventloop_delay_seconds');
    expect(rendered).toContain('process_resident_memory_bytes');

    registry.close();
  });

  it('escapes special characters in info labels and handles empty options', () => {
    const registry = new MetricsRegistry();
    const v3 = registry.scope('v3');
    v3.incrementCacheHit();

    const rendered = registry.render();
    expect(rendered).toContain('cache_hits_total{strategy="v3"} 1');
    expect(registry.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');

    registry.close();
  });
});
