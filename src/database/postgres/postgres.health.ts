import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  HealthIndicator,
  HealthStatus,
} from '../../common/ports/health-indicator.js';

@Injectable()
export class PostgresHealthIndicator implements HealthIndicator {
  readonly name = 'postgres';

  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
