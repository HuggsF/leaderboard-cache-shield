import type { Knex } from 'knex';
import { migrateLatest, migrateRollback } from '@infrastructure/database/migrator';

describe('Database Migrator', () => {
  it('calls db.migrate.latest and returns applied migration names', async () => {
    const mockDb = {
      migrate: {
        latest: jest.fn().mockResolvedValue([1, ['20260101000000_create_leaderboard_schema']]),
      },
    } as unknown as Knex;

    const names = await migrateLatest(mockDb);
    expect(names).toEqual(['20260101000000_create_leaderboard_schema']);
    expect(mockDb.migrate.latest).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'knex_migrations' }),
    );
  });

  it('calls db.migrate.rollback and returns rolled back migration names', async () => {
    const mockDb = {
      migrate: {
        rollback: jest
          .fn()
          .mockResolvedValue([1, ['20260101000100_add_leaderboard_covering_index']]),
      },
    } as unknown as Knex;

    const names = await migrateRollback(mockDb);
    expect(names).toEqual(['20260101000100_add_leaderboard_covering_index']);
    expect(mockDb.migrate.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'knex_migrations' }),
    );
  });

  it('handles empty results safely', async () => {
    const mockDb = {
      migrate: {
        latest: jest.fn().mockResolvedValue([0, []]),
      },
    } as unknown as Knex;

    const names = await migrateLatest(mockDb);
    expect(names).toEqual([]);
  });
});
