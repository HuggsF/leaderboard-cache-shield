import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '@presentation/http/errors/http-error';
import { errorHandler, notFoundHandler } from '@presentation/http/middleware/error-handler';

describe('Error Middleware', () => {
  const replyMock = (): FastifyReply => {
    const reply = {
      status: jest.fn().mockReturnThis(),
      headers: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    return reply;
  };

  const requestMock = (url = '/test', method = 'GET'): FastifyRequest =>
    ({
      url,
      method,
      log: {
        error: jest.fn(),
      },
    }) as unknown as FastifyRequest;

  it('handles HttpError correctly with custom status, headers, and code', () => {
    const reply = replyMock();
    const req = requestMock();
    const error = new HttpError(400, 'CUSTOM_ERROR', 'Something is wrong', { field: 'name' });

    errorHandler(error, req, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'CUSTOM_ERROR',
        message: 'Something is wrong',
        details: { field: 'name' },
      },
    });
  });

  it('logs error for HttpError >= 500', () => {
    const reply = replyMock();
    const req = requestMock();
    const error = new HttpError(503, 'SERVICE_UNAVAILABLE', 'Temporarily down');

    errorHandler(error, req, reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(req.log.error).toHaveBeenCalled();
  });

  it('handles Fastify client errors with status codes (e.g. 400)', () => {
    const reply = replyMock();
    const req = requestMock();
    const fastifyError = {
      statusCode: 400,
      message: 'Body cannot be empty',
    } as FastifyError;

    errorHandler(fastifyError, req, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'BAD_REQUEST',
        message: 'Body cannot be empty',
      },
    });
  });

  it('handles generic unhandled errors as 500 INTERNAL_ERROR', () => {
    const reply = replyMock();
    const req = requestMock();
    const genericError = new Error('Unexpected crash') as FastifyError;

    errorHandler(genericError, req, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
    expect(req.log.error).toHaveBeenCalled();
  });

  it('handles 404 via notFoundHandler', () => {
    const reply = replyMock();
    const req = requestMock('/missing', 'POST');

    notFoundHandler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Route POST /missing not found',
      },
    });
  });
});
