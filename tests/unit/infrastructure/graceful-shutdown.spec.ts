import { registerGracefulShutdown } from '@infrastructure/lifecycle/graceful-shutdown';
import type { ProcessLike, ShutdownTask } from '@infrastructure/lifecycle/graceful-shutdown';
import { createLoggerMock } from '../../support/fakes';

describe('registerGracefulShutdown', () => {
  it('executes shutdown tasks sequentially and invokes exit callback', async () => {
    const logger = createLoggerMock();
    const order: string[] = [];
    const tasks: ShutdownTask[] = [
      {
        name: 'task-1',
        close: jest.fn().mockImplementation(() => {
          order.push('task-1');
          return Promise.resolve();
        }),
      },
      {
        name: 'task-2',
        close: jest.fn().mockImplementation(() => {
          order.push('task-2');
          return Promise.resolve();
        }),
      },
    ];

    const exitMock = jest.fn();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const fakeProcess: ProcessLike = {
      on: jest.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
        return fakeProcess;
      }),
      off: jest.fn().mockImplementation((event: string) => {
        handlers.delete(event);
        return fakeProcess;
      }),
    };

    const lifecycle = registerGracefulShutdown({
      logger,
      tasks,
      timeoutMs: 1000,
      exit: exitMock,
      process: fakeProcess,
      signals: ['SIGTERM'],
      handleFatalErrors: true,
    });

    await lifecycle.shutdown('manual', 0);

    expect(order).toEqual(['task-1', 'task-2']);
    expect(exitMock).toHaveBeenCalledWith(0);

    lifecycle.dispose();
    expect(fakeProcess.off).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('exits with code 1 if a task fails', async () => {
    const logger = createLoggerMock();
    const tasks: ShutdownTask[] = [
      {
        name: 'failing-task',
        close: jest.fn().mockRejectedValue(new Error('Crash during cleanup')),
      },
    ];

    const exitMock = jest.fn();
    const fakeProcess: ProcessLike = {
      on: jest.fn(),
      off: jest.fn(),
    };

    const lifecycle = registerGracefulShutdown({
      logger,
      tasks,
      timeoutMs: 1000,
      exit: exitMock,
      process: fakeProcess,
    });

    await lifecycle.shutdown('manual', 0);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
