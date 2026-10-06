import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '@presentation/http/errors/http-error';
import type { ErrorResponseBody } from '@presentation/http/errors/http-error';

/** Errors raised by Fastify itself (bad content type, malformed URL…) carry a 4xx status. */
const clientErrorStatus = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return null;
  }
  const { statusCode } = error;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
};

const body = (code: string, message: string, details?: unknown): ErrorResponseBody => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/** Every error becomes a JSON body; internals are logged, never leaked. */
export const errorHandler = (
  error: FastifyError | HttpError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply => {
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      request.log.error({ err: error.cause ?? error, path: request.url }, 'Request failed');
    }
    return reply
      .status(error.status)
      .headers(error.headers)
      .send(body(error.code, error.message, error.details));
  }
  const status = clientErrorStatus(error);
  if (status !== null) {
    return reply.status(status).send(body('BAD_REQUEST', error.message));
  }
  request.log.error({ err: error, method: request.method, path: request.url }, 'Unhandled error');
  return reply.status(500).send(body('INTERNAL_ERROR', 'Internal server error'));
};

export const notFoundHandler = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
  reply.status(404).send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
