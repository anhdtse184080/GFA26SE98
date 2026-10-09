import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, type HealthReport } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<HealthReport> {
    const report = await this.healthService.check();
    if (report.status === 'down') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
