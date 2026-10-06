import type { Knex } from 'knex';
import {
  EXIT_FAILURE,
  EXIT_OK,
  runMigrateCommand,
} from '@presentation/cli/commands/migrate.command';
import * as migrator from '@infrastructure/database/migrator';

describe('runMigrateCommand', () => {
  it('applies latest migrations and returns EXIT_OK', async () => {
    jest.spyOn(migrator, 'migrateLatest').mockResolvedValue(['20260101_init']);
    const destroyMock = jest.fn().mockResolvedValue(undefined);
    const mockDb = { destroy: destroyMock } as unknown as Knex;

    const stdoutMock = { write: jest.fn() };
    const stderrMock = { write: jest.fn() };

    const exitCode = await runMigrateCommand(
      { rollback: false },
      {
        createDatabase: () => mockDb,
        stdout: stdoutMock,
        stderr: stderrMock,
      },
    );

    expect(exitCode).toBe(EXIT_OK);
    expect(stdoutMock.write).toHaveBeenCalledWith(expect.stringContaining('Applied 1 migration'));
    expect(destroyMock).toHaveBeenCalled();
  });

  it('rolls back migrations when rollback option is true', async () => {
    jest.spyOn(migrator, 'migrateRollback').mockResolvedValue(['20260101_init']);
    const destroyMock = jest.fn().mockResolvedValue(undefined);
    const mockDb = { destroy: destroyMock } as unknown as Knex;

    const stdoutMock = { write: jest.fn() };
    const stderrMock = { write: jest.fn() };

    const exitCode = await runMigrateCommand(
      { rollback: true },
      {
        createDatabase: () => mockDb,
        stdout: stdoutMock,
        stderr: stderrMock,
      },
    );

    expect(exitCode).toBe(EXIT_OK);
    expect(stdoutMock.write).toHaveBeenCalledWith(
      expect.stringContaining('Rolled back 1 migration'),
    );
  });

  it('outputs message when database is already up to date', async () => {
    jest.spyOn(migrator, 'migrateLatest').mockResolvedValue([]);
    const destroyMock = jest.fn().mockResolvedValue(undefined);
    const mockDb = { destroy: destroyMock } as unknown as Knex;

    const stdoutMock = { write: jest.fn() };
    const stderrMock = { write: jest.fn() };

    const exitCode = await runMigrateCommand(
      { rollback: false },
      {
        createDatabase: () => mockDb,
        stdout: stdoutMock,
        stderr: stderrMock,
      },
    );

    expect(exitCode).toBe(EXIT_OK);
    expect(stdoutMock.write).toHaveBeenCalledWith('Database already up to date\n');
  });

  it('handles migration error and returns EXIT_FAILURE', async () => {
    jest.spyOn(migrator, 'migrateLatest').mockRejectedValue(new Error('Connection lost'));
    const destroyMock = jest.fn().mockResolvedValue(undefined);
    const mockDb = { destroy: destroyMock } as unknown as Knex;

    const stdoutMock = { write: jest.fn() };
    const stderrMock = { write: jest.fn() };

    const exitCode = await runMigrateCommand(
      { rollback: false },
      {
        createDatabase: () => mockDb,
        stdout: stdoutMock,
        stderr: stderrMock,
      },
    );

    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stderrMock.write).toHaveBeenCalledWith(
      expect.stringContaining('Migration failed: Connection lost'),
    );
    expect(destroyMock).toHaveBeenCalled();
  });
});
