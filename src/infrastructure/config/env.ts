import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: port.default(3000),
    HTTP_BACKLOG: positiveInt.default(4096),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFlag.default('false'),
    LOG_REQUESTS: booleanFlag.default('false'),
    SHUTDOWN_TIMEOUT_MS: positiveInt.default(30_000),

    DB_HOST: z.string().min(1),
    DB_PORT: port,
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string().min(1),
    DB_POOL_MIN: nonNegativeInt.default(0),
    DB_POOL_MAX: positiveInt.default(10),
    DB_ACQUIRE_TIMEOUT_MS: positiveInt.default(10_000),
    DB_MIGRATE_ON_START: booleanFlag.default('false'),

    REDIS_HOST: z.string().min(1),
    REDIS_PORT: port.default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: nonNegativeInt.max(15).default(0),

    LEADERBOARD_PAGE_SIZE: positiveInt.max(100).default(50),
    LEADERBOARD_QUERY_DELAY_MS: nonNegativeInt.max(60_000).default(500),

    CACHE_FRESH_TTL_SECONDS: positiveInt.default(300),
    CACHE_STALE_TTL_SECONDS: positiveInt.default(600),

    LOCK_TTL_MS: positiveInt.default(10_000),
    LOCK_RETRY_COUNT: nonNegativeInt.default(3),
    LOCK_RETRY_DELAY_MS: nonNegativeInt.default(200),
    LOCK_RETRY_JITTER_MS: nonNegativeInt.default(50),
    LOCK_WAIT_TIMEOUT_MS: positiveInt.default(5_000),
    LOCK_POLL_INTERVAL_MS: positiveInt.default(50),
  })
  .refine((env) => env.DB_POOL_MIN <= env.DB_POOL_MAX, {
    message: 'DB_POOL_MIN must be less than or equal to DB_POOL_MAX',
    path: ['DB_POOL_MIN'],
  })
  .refine((env) => env.CACHE_STALE_TTL_SECONDS > env.CACHE_FRESH_TTL_SECONDS, {
    message:
      'CACHE_STALE_TTL_SECONDS (total lifetime) must be greater than CACHE_FRESH_TTL_SECONDS',
    path: ['CACHE_STALE_TTL_SECONDS'],
  })
  .refine((env) => env.LOCK_TTL_MS > env.LEADERBOARD_QUERY_DELAY_MS, {
    message: 'LOCK_TTL_MS must exceed LEADERBOARD_QUERY_DELAY_MS, or the lock expires mid-query',
    path: ['LOCK_TTL_MS'],
  });

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export type DatabaseConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly name: string;
  readonly pool: { readonly min: number; readonly max: number };
  readonly acquireTimeoutMs: number;
  readonly migrateOnStart: boolean;
};

export type RedisConfig = {
  readonly host: string;
  readonly port: number;
  readonly password: string | undefined;
  readonly db: number;
};

export type AppConfig = {
  readonly env: 'development' | 'test' | 'production';
  readonly http: { readonly host: string; readonly port: number; readonly backlog: number };
  readonly log: { readonly level: LogLevel; readonly pretty: boolean; readonly requests: boolean };
  readonly database: DatabaseConfig;
  readonly redis: RedisConfig;
  readonly leaderboard: { readonly pageSize: number; readonly queryDelayMs: number };
  readonly cache: { readonly freshTtlSeconds: number; readonly staleTtlSeconds: number };
  readonly lock: {
    readonly ttlMs: number;
    readonly retryCount: number;
    readonly retryDelayMs: number;
    readonly retryJitterMs: number;
    readonly waitTimeoutMs: number;
    readonly pollIntervalMs: number;
  };
  readonly shutdownTimeoutMs: number;
};

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Loads `.env` (if present) into process.env without overriding variables already set. */
export const loadEnvFile = (path?: string): void => {
  loadDotenv({ path, quiet: true });
};

/** Validates the environment once at startup: the app refuses to boot with a bad configuration. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const vars = parsed.data;

  return {
    env: vars.NODE_ENV,
    http: { host: vars.HOST, port: vars.PORT, backlog: vars.HTTP_BACKLOG },
    log: { level: vars.LOG_LEVEL, pretty: vars.LOG_PRETTY, requests: vars.LOG_REQUESTS },
    database: {
      host: vars.DB_HOST,
      port: vars.DB_PORT,
      user: vars.DB_USER,
      password: vars.DB_PASSWORD,
      name: vars.DB_NAME,
      pool: { min: vars.DB_POOL_MIN, max: vars.DB_POOL_MAX },
      acquireTimeoutMs: vars.DB_ACQUIRE_TIMEOUT_MS,
      migrateOnStart: vars.DB_MIGRATE_ON_START,
    },
    redis: {
      host: vars.REDIS_HOST,
      port: vars.REDIS_PORT,
      password: vars.REDIS_PASSWORD === '' ? undefined : vars.REDIS_PASSWORD,
      db: vars.REDIS_DB,
    },
    leaderboard: {
      pageSize: vars.LEADERBOARD_PAGE_SIZE,
      queryDelayMs: vars.LEADERBOARD_QUERY_DELAY_MS,
    },
    cache: {
      freshTtlSeconds: vars.CACHE_FRESH_TTL_SECONDS,
      staleTtlSeconds: vars.CACHE_STALE_TTL_SECONDS,
    },
    lock: {
      ttlMs: vars.LOCK_TTL_MS,
      retryCount: vars.LOCK_RETRY_COUNT,
      retryDelayMs: vars.LOCK_RETRY_DELAY_MS,
      retryJitterMs: vars.LOCK_RETRY_JITTER_MS,
      waitTimeoutMs: vars.LOCK_WAIT_TIMEOUT_MS,
      pollIntervalMs: vars.LOCK_POLL_INTERVAL_MS,
    },
    shutdownTimeoutMs: vars.SHUTDOWN_TIMEOUT_MS,
  };
};
