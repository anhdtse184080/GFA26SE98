import { Global, Module } from '@nestjs/common';
import {
  HEALTH_INDICATORS,
  type HealthIndicator,
} from '../common/ports/health-indicator.js';
import { MongoHealthIndicator } from './mongo/mongo.health.js';
import { MongoModule } from './mongo/mongo.module.js';
import { PostgresHealthIndicator } from './postgres/postgres.health.js';
import { PostgresModule } from './postgres/postgres.module.js';
import { TransactionContext } from './transaction-context.js';
import { UnitOfWork } from './unit-of-work.js';

@Global()
@Module({
  imports: [PostgresModule, MongoModule],
  providers: [
    TransactionContext,
    UnitOfWork,
    PostgresHealthIndicator,
    MongoHealthIndicator,
    {
      provide: HEALTH_INDICATORS,
      inject: [PostgresHealthIndicator, MongoHealthIndicator],
      useFactory: (...indicators: HealthIndicator[]) => indicators,
    },
  ],
  exports: [TransactionContext, UnitOfWork, HEALTH_INDICATORS],
})
export class DatabaseModule {}
