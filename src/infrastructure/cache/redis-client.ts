import { Redis } from 'ioredis';
import type { Logger } from '@application/interfaces/logger';
import type { RedisConfig } from '@infrastructure/config/env';

/**
 * ioredis client tuned for a cache in front of a fragile database:
 * - auto-pipelining: the commands of thousands of concurrent requests issued in the same tick
 *   travel in one write, which is what lets a single connection sustain a stampede;
 * - fail fast (`maxRetriesPerRequest: 1`): a request must not hang for seconds on a Redis outage.
 */
export const createRedisClient = (
  config: RedisConfig,
  connectionName: string,
  logger: Logger,
): Redis => {
  const client = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    connectionName,
    enableAutoPipelining: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  client.on('error', (error: unknown) => {
    logger.warn({ err: error, connection: connectionName }, 'Redis connection error');
  });
  return client;
};

export const pingRedis = async (client: Redis): Promise<void> => {
  await client.ping();
};

/** QUIT lets in-flight replies arrive before closing; falls back to a hard disconnect. */
export const closeRedis = async (client: Redis): Promise<void> => {
  if (client.status === 'end') {
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
};
