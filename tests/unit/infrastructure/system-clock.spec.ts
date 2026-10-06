import { SystemClock } from '@infrastructure/system/system-clock';

describe('SystemClock', () => {
  it('returns current date and monotonic timestamp', async () => {
    const clock = new SystemClock();
    const before = Date.now();
    const date = clock.now();
    const after = Date.now();

    expect(date.getTime()).toBeGreaterThanOrEqual(before);
    expect(date.getTime()).toBeLessThanOrEqual(after);

    const ms = clock.nowMs();
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThan(0);

    const sleepStart = performance.now();
    await clock.sleep(10);
    const sleepElapsed = performance.now() - sleepStart;
    expect(sleepElapsed).toBeGreaterThanOrEqual(5);
  });
});
