import type { Knex } from 'knex';
import { migrateLatest, migrateRollback } from '@infrastructure/database/migrator';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;

export type OutputStream = { write(chunk: string): unknown };

/** What the command needs from the outside world — injectable for tests. */
export type MigrateCommandContext = {
  readonly createDatabase: () => Knex;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
};

export type MigrateCommandOptions = { readonly rollback: boolean };

/** `migrate [--rollback]` — applies (or reverts the last batch of) database migrations. */
export const runMigrateCommand = async (
  options: MigrateCommandOptions,
  context: MigrateCommandContext,
): Promise<number> => {
  const db = context.createDatabase();
  try {
    const names = options.rollback ? await migrateRollback(db) : await migrateLatest(db);
    const verb = options.rollback ? 'Rolled back' : 'Applied';
    context.stdout.write(
      names.length === 0
        ? 'Database already up to date\n'
        : `${verb} ${names.length} migration(s):\n${names.map((name) => `  - ${name}`).join('\n')}\n`,
    );
    return EXIT_OK;
  } catch (error: unknown) {
    context.stderr.write(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_FAILURE;
  } finally {
    await db.destroy();
  }
};
