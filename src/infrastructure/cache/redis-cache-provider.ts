import type { Redis } from 'ioredis';
import type { CacheProvider, CachedValue } from '@application/interfaces/cache-provider';
import type { Logger } from '@application/interfaces/logger';
import type { CacheCodec } from './cache-codec';

const MISS: CachedValue<never> = { data: null, isStale: false };

/** `{entry}:data` holds the payload for the whole lifetime of the entry (stale TTL). */
export const dataKey = (entry: string): string => `${entry}:data`;

/**
 * `{entry}:stale` is the staleness marker: it holds the instant the entry turns stale and
 * expires exactly then (fresh TTL). Present = fresh, absent while `:data` exists = stale.
 * Freshness is decided by Redis TTLs, so every instance agrees regardless of clock skew.
 */
export const staleMarkerKey = (entry: string): string => `${entry}:stale`;

export class RedisCacheProvider<T> implements CacheProvider<T> {
  constructor(
    private readonly redis: Redis,
    private readonly codec: CacheCodec<T>,
    private readonly logger: Logger,
  ) {}

  async get(key: string): Promise<T | null> {
    const raw = await this.redis.get(dataKey(key));
    return raw === null ? null : this.decode(key, raw);
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(dataKey(key), this.codec.encode(value), 'EX', ttlSeconds);
  }

  /** One round trip (MGET) returns the payload and its freshness marker atomically. */
  async getWithStaleSupport(key: string): Promise<CachedValue<T>> {
    const [raw, marker] = await this.redis.mget(dataKey(key), staleMarkerKey(key));
    if (raw === null || raw === undefined) {
      return MISS;
    }
    const data = this.decode(key, raw);
    if (data === null) {
      return MISS;
    }
    return { data, isStale: marker === null || marker === undefined };
  }

  /** Writes payload + marker in one MULTI so readers never see a half-written entry. */
  async setWithStaleSupport(
    key: string,
    value: T,
    freshTtlSeconds: number,
    staleTtlSeconds: number,
  ): Promise<void> {
    const staleAt = new Date(Date.now() + freshTtlSeconds * 1000).toISOString();
    const results = await this.redis
      .multi()
      .set(dataKey(key), this.codec.encode(value), 'EX', staleTtlSeconds)
      .set(staleMarkerKey(key), staleAt, 'EX', freshTtlSeconds)
      .exec();
    const failure = results?.find(([error]) => error !== null)?.[0];
    if (results === null || failure) {
      throw failure ?? new Error(`Cache transaction for ${key} was aborted`);
    }
  }

  async isFresh(key: string): Promise<boolean> {
    return (await this.redis.exists(staleMarkerKey(key))) === 1;
  }

  private decode(key: string, raw: string): T | null {
    const value = this.codec.decode(raw);
    if (value === null) {
      this.logger.warn({ key }, 'Ignoring an undecodable cache entry (treated as a miss)');
    }
    return value;
  }
}
