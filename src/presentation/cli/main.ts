import '../../module-aliases';
import { parseArgs } from 'node:util';
import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { createDatabase } from '@infrastructure/database/knex';
import { EXIT_FAILURE, runMigrateCommand } from '@presentation/cli/commands/migrate.command';

const USAGE = 'Usage: main migrate [--rollback]\n';

/** CLI entry point: `migrate [--rollback]`. */
const main = async (): Promise<number> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { rollback: { type: 'boolean', default: false } },
  });
  if (positionals[0] !== 'migrate') {
    process.stderr.write(USAGE);
    return EXIT_FAILURE;
  }
  loadEnvFile();
  const config = loadConfig();
  return runMigrateCommand(
    { rollback: values.rollback },
    {
      createDatabase: () => createDatabase(config.database),
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  });
