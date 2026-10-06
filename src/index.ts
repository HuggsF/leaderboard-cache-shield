import './module-aliases';
import { buildContainer } from '@infrastructure/config/container';
import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { migrateLatest } from '@infrastructure/database/migrator';
import { registerGracefulShutdown } from '@infrastructure/lifecycle/graceful-shutdown';
import { createLogger } from '@infrastructure/logging/logger';
import { buildHttpApp, listen } from '@presentation/http/server';

/** HTTP entry point: /api/v{1,2,3}/leaderboard, /metrics, /health. */
const main = async (): Promise<void> => {
  loadEnvFile();
  const config = loadConfig();
  const logger = createLogger(config.log);
  const container = buildContainer(config, logger);

  if (config.database.migrateOnStart) {
    const applied = await migrateLatest(container.db);
    logger.info({ applied }, 'Database migrations applied');
  }

  const app = buildHttpApp(container);
  const address = await listen(app, container);
  logger.info(
    {
      address,
      env: config.env,
      queryDelayMs: config.leaderboard.queryDelayMs,
      dbPoolMax: config.database.pool.max,
    },
    'HTTP server listening',
  );

  registerGracefulShutdown({
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    // Stop accepting requests and finish in-flight ones, then let background SWR refreshes
    // land, then close Redis and the MySQL pool.
    tasks: [{ name: 'http-server', close: () => app.close() }, ...container.shutdownTasks()],
  });
};

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: failed to start the server\n${String(error)}\n`);
  process.exit(1);
});
