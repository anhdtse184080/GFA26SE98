import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type {
  HealthIndicator,
  HealthStatus,
} from '../../common/ports/health-indicator.js';

@Injectable()
export class MongoHealthIndicator implements HealthIndicator {
  readonly name = 'mongo';

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async check(): Promise<HealthStatus> {
    try {
      if (!this.connection.db) return 'down';
      await this.connection.db.admin().ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
