import { ConfigValidationError, loadConfig, loadEnvFile } from '@infrastructure/config/env';

describe('Environment Config', () => {
  const validEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'testuser',
    DB_PASSWORD: 'testpassword',
    DB_NAME: 'testdb',
    DB_POOL_MIN: '2',
    DB_POOL_MAX: '10',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: '',
    REDIS_DB: '1',
    CACHE_FRESH_TTL_SECONDS: '300',
    CACHE_STALE_TTL_SECONDS: '600',
    LOCK_TTL_MS: '10000',
    LEADERBOARD_QUERY_DELAY_MS: '500',
    LOG_LEVEL: 'info',
    LOG_PRETTY: 'false',
    LOG_REQUESTS: 'false',
    DB_MIGRATE_ON_START: 'true',
  };

  it('loads valid configuration successfully', () => {
    const config = loadConfig(validEnv);
    expect(config.env).toBe('test');
    expect(config.http.host).toBe('127.0.0.1');
    expect(config.http.port).toBe(3000);
    expect(config.database.host).toBe('localhost');
    expect(config.database.port).toBe(3306);
    expect(config.database.migrateOnStart).toBe(true);
    expect(config.redis.password).toBeUndefined();
    expect(config.redis.db).toBe(1);
    expect(config.cache.freshTtlSeconds).toBe(300);
    expect(config.cache.staleTtlSeconds).toBe(600);
    expect(config.lock.ttlMs).toBe(10_000);
  });

  it('throws ConfigValidationError on missing required fields', () => {
    expect(() => loadConfig({})).toThrow(ConfigValidationError);
    try {
      loadConfig({});
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const configErr = err as ConfigValidationError;
      expect(configErr.issues.length).toBeGreaterThan(0);
      expect(configErr.name).toBe('ConfigValidationError');
    }
  });

  it('throws when DB_POOL_MIN is greater than DB_POOL_MAX', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        DB_POOL_MIN: '20',
        DB_POOL_MAX: '5',
      }),
    ).toThrow(ConfigValidationError);
  });

  it('throws when CACHE_STALE_TTL_SECONDS is not greater than CACHE_FRESH_TTL_SECONDS', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        CACHE_FRESH_TTL_SECONDS: '300',
        CACHE_STALE_TTL_SECONDS: '300',
      }),
    ).toThrow(ConfigValidationError);
  });

  it('throws when LOCK_TTL_MS does not exceed LEADERBOARD_QUERY_DELAY_MS', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        LOCK_TTL_MS: '500',
        LEADERBOARD_QUERY_DELAY_MS: '1000',
      }),
    ).toThrow(ConfigValidationError);
  });

  it('calls loadEnvFile safely', () => {
    expect(() => {
      loadEnvFile();
    }).not.toThrow();
  });
});
