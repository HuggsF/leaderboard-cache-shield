import { createLogger } from '@infrastructure/logging/logger';

describe('createLogger', () => {
  it('creates a pino logger with specified options', () => {
    const logger = createLogger({
      level: 'silent',
      pretty: false,
      name: 'test-logger',
    });

    expect(logger).toBeDefined();
    expect(logger.level).toBe('silent');
  });

  it('creates pretty logger when pretty is true', () => {
    const logger = createLogger({
      level: 'debug',
      pretty: true,
      name: 'pretty-logger',
    });

    expect(logger).toBeDefined();
    expect(logger.level).toBe('debug');
  });
});
