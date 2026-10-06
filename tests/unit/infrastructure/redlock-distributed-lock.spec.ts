import type { ExecutionStats, Lock } from 'redlock';
import Redlock, { ExecutionError, ResourceLockedError } from 'redlock';
import {
  createRedlock,
  RedlockDistributedLock,
} from '@infrastructure/lock/redlock-distributed-lock';
import type { Redis } from 'ioredis';

describe('RedlockDistributedLock', () => {
  it('creates redlock client instance', () => {
    const mockRedis = {} as Redis;
    const client = createRedlock(mockRedis, {
      retryCount: 3,
      retryDelayMs: 200,
      retryJitterMs: 50,
    });
    expect(client).toBeInstanceOf(Redlock);
  });

  it('acquires and releases a lock successfully', async () => {
    const lockObj = {
      value: 'random-lock-token-123',
      resources: ['my-resource-key'],
    } as Lock;

    const redlockMock = {
      acquire: jest.fn().mockResolvedValue(lockObj),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as Redlock;

    const lockAdapter = new RedlockDistributedLock(redlockMock);

    const token = await lockAdapter.acquire('my-resource-key', 5000);
    expect(token).toBe('random-lock-token-123');
    expect(lockAdapter.heldLocks).toBe(1);

    const released = await lockAdapter.release('my-resource-key', 'random-lock-token-123');
    expect(released).toBe(true);
    expect(lockAdapter.heldLocks).toBe(0);
  });

  it('returns null on lock contention (already locked)', async () => {
    const attempt = {
      membershipSize: 1,
      quorumSize: 1,
      votesFor: new Set<never>(),
      votesAgainst: new Map([[{} as never, new ResourceLockedError('Resource locked')]]),
    };
    const executionError = new ExecutionError('The operation was unable to achieve a quorum.', [
      Promise.resolve(attempt as unknown as ExecutionStats),
    ]);

    const redlockMock = {
      acquire: jest.fn().mockRejectedValue(executionError),
    } as unknown as Redlock;

    const lockAdapter = new RedlockDistributedLock(redlockMock);
    const token = await lockAdapter.acquire('locked-resource', 5000);

    expect(token).toBeNull();
  });

  it('re-throws non-contention unexpected errors on acquire', async () => {
    const redlockMock = {
      acquire: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
    } as unknown as Redlock;

    const lockAdapter = new RedlockDistributedLock(redlockMock);
    await expect(lockAdapter.acquire('locked-resource', 5000)).rejects.toThrow(
      'Redis connection refused',
    );
  });

  it('returns false when releasing an unknown or mismatched lockId', async () => {
    const redlockMock = {
      release: jest.fn(),
    } as unknown as Redlock;

    const lockAdapter = new RedlockDistributedLock(redlockMock);
    const released = await lockAdapter.release('resource', 'non-held-lock');
    expect(released).toBe(false);
    expect(redlockMock.release).not.toHaveBeenCalled();
  });
});
