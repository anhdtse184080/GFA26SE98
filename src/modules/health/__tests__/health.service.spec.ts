import type {
  HealthIndicator,
  HealthStatus,
} from '../../../common/ports/health-indicator.js';
import { HEALTH_CHECK_TIMEOUT_MS, HealthService } from '../health.service.js';

const indicator = (name: string, status: HealthStatus): HealthIndicator => ({
  name,
  check: () => Promise.resolve(status),
});

describe('HealthService', () => {
  it('trả "up" khi mọi indicator đều up', async () => {
    const service = new HealthService([
      indicator('postgres', 'up'),
      indicator('mongo', 'up'),
    ]);

    await expect(service.check()).resolves.toEqual({
      status: 'up',
      details: { postgres: 'up', mongo: 'up' },
    });
  });

  it('trả "down" khi có một indicator down', async () => {
    const service = new HealthService([
      indicator('postgres', 'up'),
      indicator('mongo', 'down'),
    ]);

    await expect(service.check()).resolves.toEqual({
      status: 'down',
      details: { postgres: 'up', mongo: 'down' },
    });
  });

  it('coi indicator không phản hồi kịp là "down"', async () => {
    vi.useFakeTimers();
    try {
      const hanging: HealthIndicator = {
        name: 'mongo',
        check: () => new Promise<HealthStatus>(() => {}),
      };
      const service = new HealthService([indicator('postgres', 'up'), hanging]);

      const pending = service.check();
      await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);

      await expect(pending).resolves.toEqual({
        status: 'down',
        details: { postgres: 'up', mongo: 'down' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
