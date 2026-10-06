import { knex } from 'knex';
import type { Knex } from 'knex';
import type { DatabaseConfig } from '@infrastructure/config/env';

/**
 * MySQL connection pool (mysql2 driver). The pool size is the hard cap on concurrent queries:
 * under a stampede the extra requests queue here and fail after `acquireTimeoutMs`.
 */
export const createDatabase = (config: DatabaseConfig): Knex =>
  knex({
    client: 'mysql2',
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.name,
      charset: 'utf8mb4',
      timezone: 'Z',
      // SUM() returns DECIMAL: get it as a JS number (values are bounded by the Score VO).
      decimalNumbers: true,
    },
    pool: { min: config.pool.min, max: config.pool.max },
    acquireConnectionTimeout: config.acquireTimeoutMs,
  });

export const pingDatabase = async (db: Knex): Promise<void> => {
  await db.raw('SELECT 1');
};
