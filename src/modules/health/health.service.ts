import { Inject, Injectable } from '@nestjs/common';
import {
  HEALTH_INDICATORS,
  type HealthIndicator,
  type HealthStatus,
} from '../../common/ports/health-indicator.js';

export interface HealthReport {
  status: HealthStatus;
  details: Record<string, HealthStatus>;
}

/** Indicator không phản hồi trong thời gian này thì coi là down (tránh treo request khi mất kết nối). */
export const HEALTH_CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  constructor(
    @Inject(HEALTH_INDICATORS) private readonly indicators: HealthIndicator[],
  ) {}

  async check(): Promise<HealthReport> {
    const results = await Promise.all(
      this.indicators.map(
        async (i) => [i.name, await this.checkWithTimeout(i)] as const,
      ),
    );
    const status: HealthStatus = results.every(([, s]) => s === 'up')
      ? 'up'
      : 'down';
    return { status, details: Object.fromEntries(results) };
  }

  private async checkWithTimeout(
    indicator: HealthIndicator,
  ): Promise<HealthStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<HealthStatus>((resolve) => {
      timer = setTimeout(() => resolve('down'), HEALTH_CHECK_TIMEOUT_MS);
    });
    try {
      return await Promise.race([indicator.check(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
