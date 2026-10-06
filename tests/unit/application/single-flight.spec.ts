import { SingleFlight } from '@application/services/single-flight';
import { flushAsync } from '../../support/fakes';

describe('SingleFlight', () => {
  it('shares one execution between concurrent callers of the same key', async () => {
    const flights = new SingleFlight<number>();
    const task = jest.fn(async () => {
      await flushAsync(1);
      return 42;
    });

    const first = flights.run('page:1', task);
    const second = flights.run('page:1', task);

    expect(first.shared).toBe(false);
    expect(second.shared).toBe(true);
    expect(second.promise).toBe(first.promise);
    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual([42, 42]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs different keys independently', async () => {
    const flights = new SingleFlight<string>();

    const results = await Promise.all([
      flights.run('a', () => Promise.resolve('A')).promise,
      flights.run('b', () => Promise.resolve('B')).promise,
    ]);

    expect(results).toEqual(['A', 'B']);
  });

  it('forgets a key once its flight settles (next call starts a new flight)', async () => {
    const flights = new SingleFlight<number>();
    let calls = 0;
    const task = (): Promise<number> => Promise.resolve((calls += 1));

    await flights.run('k', task).promise;
    const next = flights.run('k', task);

    expect(next.shared).toBe(false);
    await expect(next.promise).resolves.toBe(2);
    expect(flights.size).toBe(0);
  });

  it('propagates a failure to every caller, including synchronous throws', async () => {
    const flights = new SingleFlight<number>();
    const task = (): Promise<number> => {
      throw new Error('boom');
    };

    const first = flights.run('k', task);
    const second = flights.run('k', task);

    await expect(first.promise).rejects.toThrow('boom');
    await expect(second.promise).rejects.toThrow('boom');
    expect(flights.size).toBe(0);
  });

  it('drains every flight, including ones started while draining', async () => {
    const flights = new SingleFlight<void>();
    const order: string[] = [];
    flights.run('first', async () => {
      await flushAsync(2);
      order.push('first');
      flights.run('second', async () => {
        await flushAsync(2);
        order.push('second');
      });
    });

    await flights.drain();

    expect(order).toEqual(['first', 'second']);
    expect(flights.size).toBe(0);
  });

  it('drains immediately when idle', async () => {
    await expect(new SingleFlight<void>().drain()).resolves.toBeUndefined();
  });
});
