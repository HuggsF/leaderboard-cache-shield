import { closeRedis, pingRedis } from '@infrastructure/cache/redis-client';
import type { Redis } from 'ioredis';

describe('redis-client helpers', () => {
  it('pings redis client', async () => {
    const mockRedis = {
      ping: jest.fn().mockResolvedValue('PONG'),
    } as unknown as Redis;

    await pingRedis(mockRedis);
    expect(mockRedis.ping).toHaveBeenCalled();
  });

  it('closes redis client cleanly via quit', async () => {
    const mockRedis = {
      status: 'ready',
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    } as unknown as Redis;

    await closeRedis(mockRedis);
    expect(mockRedis.quit).toHaveBeenCalled();
    expect(mockRedis.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects if quit throws', async () => {
    const mockRedis = {
      status: 'ready',
      quit: jest.fn().mockRejectedValue(new Error('Connection broken')),
      disconnect: jest.fn(),
    } as unknown as Redis;

    await closeRedis(mockRedis);
    expect(mockRedis.disconnect).toHaveBeenCalled();
  });

  it('does nothing if client already ended', async () => {
    const mockRedis = {
      status: 'end',
      quit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Redis;

    await closeRedis(mockRedis);
    expect(mockRedis.quit).not.toHaveBeenCalled();
    expect(mockRedis.disconnect).not.toHaveBeenCalled();
  });
});
