import { createDatabase, pingDatabase } from '@infrastructure/database/knex';
import type { DatabaseConfig } from '@infrastructure/config/env';
import type { Knex } from 'knex';

describe('Database Knex Configuration', () => {
  const config: DatabaseConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'password',
    name: 'test_db',
    pool: { min: 2, max: 10 },
    acquireTimeoutMs: 5000,
    migrateOnStart: false,
  };

  it('creates Knex instance configured with connection pool', () => {
    const db = createDatabase(config);
    expect(db).toBeDefined();
    expect(typeof db.raw).toBe('function');
    void db.destroy();
  });

  it('pings database with SELECT 1', async () => {
    const dbMock = {
      raw: jest.fn().mockResolvedValue([[{ '1': 1 }]]),
    } as unknown as Knex;

    await pingDatabase(dbMock);
    expect(dbMock.raw).toHaveBeenCalledWith('SELECT 1');
  });
});
