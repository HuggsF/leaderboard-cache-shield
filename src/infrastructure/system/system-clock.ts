import { setTimeout as delay } from 'node:timers/promises';
import type { Clock } from '@application/interfaces/clock';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return performance.now();
  }

  async sleep(ms: number): Promise<void> {
    await delay(ms);
  }
}
