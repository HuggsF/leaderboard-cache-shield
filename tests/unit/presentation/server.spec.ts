import type { Container } from '@infrastructure/config/container';
import { createLogger } from '@infrastructure/logging/logger';
import { buildHttpApp, listen } from '@presentation/http/server';
import type { FastifyInstance } from 'fastify';

describe('HTTP Server Module', () => {
  const containerMock = {
    logger: createLogger({ level: 'silent', pretty: false }),
    config: {
      log: { requests: false },
      http: { host: '127.0.0.1', port: 8080, backlog: 512 },
    },
    getLeaderboardNaive: { execute: jest.fn() },
    getLeaderboardWithLock: { execute: jest.fn() },
    getLeaderboardSWR: { execute: jest.fn() },
    checkHealth: { execute: jest.fn() },
    exportMetrics: { execute: jest.fn() },
  } as unknown as Container;

  it('builds http app with wired controllers', () => {
    const app = buildHttpApp(containerMock);
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });

  it('calls app.listen with container host and port', async () => {
    const appMock = {
      listen: jest.fn().mockResolvedValue('http://127.0.0.1:8080'),
    } as unknown as FastifyInstance;

    const address = await listen(appMock, containerMock);
    expect(address).toBe('http://127.0.0.1:8080');
    expect(appMock.listen).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 8080,
      backlog: 512,
    });
  });
});
