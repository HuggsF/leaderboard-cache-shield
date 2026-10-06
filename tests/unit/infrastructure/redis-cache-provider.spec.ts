import type { Redis } from 'ioredis';
import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import { leaderboardCodec } from '@infrastructure/cache/cache-codec';
import {
  dataKey,
  RedisCacheProvider,
  staleMarkerKey,
} from '@infrastructure/cache/redis-cache-provider';
import { createLoggerMock, leaderboardDto } from '../../support/fakes';

describe('RedisCacheProvider', () => {
  const logger = createLoggerMock();
  const dto = leaderboardDto();
  const encoded = leaderboardCodec.encode(dto);

  it('generates correct key names', () => {
    expect(dataKey('leaderboard:page:1')).toBe('leaderboard:page:1:data');
    expect(staleMarkerKey('leaderboard:page:1')).toBe('leaderboard:page:1:stale');
  });

  it('gets a value when present in Redis', async () => {
    const mockRedis = {
      get: jest.fn().mockResolvedValue(encoded),
    } as unknown as Redis;

    const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
    const result = await provider.get('leaderboard:page:1');

    expect(result).toEqual(dto);
    expect(mockRedis.get).toHaveBeenCalledWith('leaderboard:page:1:data');
  });

  it('returns null on cache miss', async () => {
    const mockRedis = {
      get: jest.fn().mockResolvedValue(null),
    } as unknown as Redis;

    const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
    const result = await provider.get('leaderboard:page:1');

    expect(result).toBeNull();
  });

  it('returns null and logs warning on undecodable cache entry', async () => {
    const mockRedis = {
      get: jest.fn().mockResolvedValue('corrupted-data{'),
    } as unknown as Redis;

    const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
    const result = await provider.get('leaderboard:page:1');

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'leaderboard:page:1' }),
      expect.any(String),
    );
  });

  it('sets a value with TTL', async () => {
    const mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
    } as unknown as Redis;

    const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
    await provider.set('leaderboard:page:1', dto, 300);

    expect(mockRedis.set).toHaveBeenCalledWith('leaderboard:page:1:data', encoded, 'EX', 300);
  });

  it('checks freshness using isFresh', async () => {
    const mockRedis = {
      exists: jest.fn().mockResolvedValue(1),
    } as unknown as Redis;

    const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
    const fresh = await provider.isFresh('leaderboard:page:1');
    expect(fresh).toBe(true);
    expect(mockRedis.exists).toHaveBeenCalledWith('leaderboard:page:1:stale');
  });

  describe('getWithStaleSupport', () => {
    it('returns fresh data when both data and stale marker are present', async () => {
      const mockRedis = {
        mget: jest.fn().mockResolvedValue([encoded, '2026-10-06T12:00:00.000Z']),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      const result = await provider.getWithStaleSupport('leaderboard:page:1');

      expect(result).toEqual({ data: dto, isStale: false });
    });

    it('returns stale data when data is present but marker is expired (null)', async () => {
      const mockRedis = {
        mget: jest.fn().mockResolvedValue([encoded, null]),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      const result = await provider.getWithStaleSupport('leaderboard:page:1');

      expect(result).toEqual({ data: dto, isStale: true });
    });

    it('returns miss when data is absent', async () => {
      const mockRedis = {
        mget: jest.fn().mockResolvedValue([null, null]),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      const result = await provider.getWithStaleSupport('leaderboard:page:1');

      expect(result).toEqual({ data: null, isStale: false });
    });

    it('returns miss when data is corrupt', async () => {
      const mockRedis = {
        mget: jest.fn().mockResolvedValue(['invalid-json', null]),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      const result = await provider.getWithStaleSupport('leaderboard:page:1');

      expect(result).toEqual({ data: null, isStale: false });
    });
  });

  describe('setWithStaleSupport', () => {
    it('executes Redis MULTI transaction successfully', async () => {
      const multiMock = {
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 'OK'],
          [null, 'OK'],
        ]),
      };
      const mockRedis = {
        multi: jest.fn().mockReturnValue(multiMock),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      await provider.setWithStaleSupport('leaderboard:page:1', dto, 300, 600);

      expect(mockRedis.multi).toHaveBeenCalled();
      expect(multiMock.set).toHaveBeenCalledTimes(2);
      expect(multiMock.exec).toHaveBeenCalled();
    });

    it('throws error when transaction fails or is aborted', async () => {
      const multiMock = {
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[new Error('Redis failure'), null]]),
      };
      const mockRedis = {
        multi: jest.fn().mockReturnValue(multiMock),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      await expect(
        provider.setWithStaleSupport('leaderboard:page:1', dto, 300, 600),
      ).rejects.toThrow('Redis failure');
    });

    it('throws when results are null', async () => {
      const multiMock = {
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };
      const mockRedis = {
        multi: jest.fn().mockReturnValue(multiMock),
      } as unknown as Redis;

      const provider = new RedisCacheProvider<LeaderboardDTO>(mockRedis, leaderboardCodec, logger);
      await expect(
        provider.setWithStaleSupport('leaderboard:page:1', dto, 300, 600),
      ).rejects.toThrow('Cache transaction for leaderboard:page:1 was aborted');
    });
  });
});
