import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/auth/decorators.js';
import { HealthService, type HealthReport } from './health.service.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Down → 503 kèm report. Không ném `ServiceUnavailableException`, vì
   * `DomainExceptionFilter` che mọi lỗi 5xx thành 500 INTERNAL_ERROR.
   */
  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.healthService.check();
    if (report.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
