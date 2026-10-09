import type { Clock } from '../../src/common/ports/clock.js';

/**
 * Clock cho test: thời gian đứng yên cho tới khi gọi `advance`.
 * E2E: `.overrideProvider(CLOCK).useValue(fakeClock)`.
 */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date()) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
