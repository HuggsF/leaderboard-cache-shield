import { LeaderboardUnavailableError } from '@application/errors/leaderboard-unavailable.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { RETRY_AFTER_SECONDS, toHttpError } from '@presentation/http/errors/error-mapper';
import { HttpError } from '@presentation/http/errors/http-error';

describe('toHttpError', () => {
  it('maps INVALID_PAGE_REQUEST to 400 Bad Request', () => {
    const domainError = new InvalidPageRequestError('page', 0, 'must be positive');
    const httpError = toHttpError(domainError);

    expect(httpError).toBeInstanceOf(HttpError);
    expect(httpError.status).toBe(400);
    expect(httpError.code).toBe('INVALID_PAGE_REQUEST');
  });

  it('maps LEADERBOARD_UNAVAILABLE to 503 with Retry-After header', () => {
    const error = new LeaderboardUnavailableError(500);
    const httpError = toHttpError(error);

    expect(httpError).toBeInstanceOf(HttpError);
    expect(httpError.status).toBe(503);
    expect(httpError.code).toBe('LEADERBOARD_UNAVAILABLE');
    expect(httpError.headers['retry-after']).toBe(RETRY_AFTER_SECONDS);
  });

  it('maps UNEXPECTED_ERROR to 500 Internal Server Error without leaking internal cause', () => {
    const originalError = new Error('Database disk crashed');
    const unexpected = new UnexpectedError('GetLeaderboard', originalError);
    const httpError = toHttpError(unexpected);

    expect(httpError).toBeInstanceOf(HttpError);
    expect(httpError.status).toBe(500);
    expect(httpError.code).toBe('INTERNAL_ERROR');
    expect(httpError.message).toBe('Internal server error');
    expect(httpError.cause).toBe(unexpected);
  });
});
