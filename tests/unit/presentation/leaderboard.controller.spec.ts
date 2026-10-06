import type { FastifyReply, FastifyRequest } from 'fastify';
import { LeaderboardController } from '@presentation/http/controllers/leaderboard.controller';
import { HttpError } from '@presentation/http/errors/http-error';
import { fail, ok } from '@domain/shared/result';
import { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { leaderboardDto } from '../../support/fakes';

describe('LeaderboardController', () => {
  const dto = leaderboardDto();

  const useCases = {
    naive: {
      execute: jest.fn().mockResolvedValue(ok({ leaderboard: dto, cacheStatus: 'MISS' })),
    },
    lock: {
      execute: jest.fn().mockResolvedValue(ok({ leaderboard: dto, cacheStatus: 'HIT' })),
    },
    swr: {
      execute: jest.fn().mockResolvedValue(ok({ leaderboard: dto, cacheStatus: 'STALE' })),
    },
  };

  const replyMock = (): FastifyReply =>
    ({
      headers: jest.fn().mockReturnThis(),
    }) as unknown as FastifyReply;

  it('handles getNaive successfully and sets response headers', async () => {
    const controller = new LeaderboardController(useCases);
    const reply = replyMock();
    const req = { query: { page: '1' } } as unknown as FastifyRequest;

    const body = await controller.getNaive(req, reply);

    expect(body).toEqual(dto);
    expect(useCases.naive.execute).toHaveBeenCalledWith({ page: 1 });
    expect(reply.headers).toHaveBeenCalledWith({
      'x-cache': 'MISS',
      'x-cache-strategy': 'naive',
      'cache-control': 'no-store',
    });
  });

  it('handles getWithLock successfully', async () => {
    const controller = new LeaderboardController(useCases);
    const reply = replyMock();
    const req = { query: { page: '2' } } as unknown as FastifyRequest;

    const body = await controller.getWithLock(req, reply);

    expect(body).toEqual(dto);
    expect(useCases.lock.execute).toHaveBeenCalledWith({ page: 2 });
    expect(reply.headers).toHaveBeenCalledWith({
      'x-cache': 'HIT',
      'x-cache-strategy': 'lock',
      'cache-control': 'no-store',
    });
  });

  it('handles getSwr successfully', async () => {
    const controller = new LeaderboardController(useCases);
    const reply = replyMock();
    const req = { query: { page: '3' } } as unknown as FastifyRequest;

    const body = await controller.getSwr(req, reply);

    expect(body).toEqual(dto);
    expect(useCases.swr.execute).toHaveBeenCalledWith({ page: 3 });
    expect(reply.headers).toHaveBeenCalledWith({
      'x-cache': 'STALE',
      'x-cache-strategy': 'swr',
      'cache-control': 'no-store',
    });
  });

  it('throws HttpError 400 on invalid query params', async () => {
    const controller = new LeaderboardController(useCases);
    const reply = replyMock();
    const req = { query: { page: '-5' } } as unknown as FastifyRequest;

    await expect(controller.getNaive(req, reply)).rejects.toThrow(HttpError);
    try {
      await controller.getNaive(req, reply);
    } catch (err) {
      const httpErr = err as HttpError;
      expect(httpErr.status).toBe(400);
      expect(httpErr.code).toBe('VALIDATION_ERROR');
    }
  });

  it('translates use case domain failure to HttpError', async () => {
    const failingUseCase = {
      execute: jest
        .fn()
        .mockResolvedValue(fail(new InvalidPageRequestError('page', 9999, 'Page exceeds max'))),
    };
    const controller = new LeaderboardController({
      ...useCases,
      naive: failingUseCase,
    });
    const reply = replyMock();
    const req = { query: { page: '9999' } } as unknown as FastifyRequest;

    await expect(controller.getNaive(req, reply)).rejects.toThrow(HttpError);
  });
});
