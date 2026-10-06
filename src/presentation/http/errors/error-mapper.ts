import type { GetLeaderboardError } from '@application/services/leaderboard-query';
import { HttpError } from './http-error';

/** Clients should retry quickly: the rebuild they waited for usually lands within a second. */
export const RETRY_AFTER_SECONDS = '1';

/** Translates use-case failures (Result errors) into HTTP semantics. */
export const toHttpError = (error: GetLeaderboardError): HttpError => {
  switch (error.code) {
    case 'INVALID_PAGE_REQUEST':
      return new HttpError(400, error.code, error.message);
    case 'LEADERBOARD_UNAVAILABLE':
      return new HttpError(503, error.code, error.message, undefined, {
        'retry-after': RETRY_AFTER_SECONDS,
      });
    case 'UNEXPECTED_ERROR':
      // Internals are logged by the error handler, never leaked to the client.
      return new HttpError(
        500,
        'INTERNAL_ERROR',
        'Internal server error',
        undefined,
        {},
        {
          cause: error,
        },
      );
  }
};
