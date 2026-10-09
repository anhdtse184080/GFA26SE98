import { Global, Module } from '@nestjs/common';
import { MongoModule } from './mongo/mongo.module.js';
import { PostgresModule } from './postgres/postgres.module.js';
import { TransactionContext } from './transaction-context.js';
import { UnitOfWork } from './unit-of-work.js';

@Global()
@Module({
  imports: [PostgresModule, MongoModule],
  providers: [TransactionContext, UnitOfWork],
  exports: [TransactionContext, UnitOfWork],
})
export class DatabaseModule {}
