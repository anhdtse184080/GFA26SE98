import { Global, Module } from '@nestjs/common';
import { PostgresModule } from './postgres/postgres.module.js';
import { TransactionContext } from './transaction-context.js';
import { UnitOfWork } from './unit-of-work.js';

@Global()
@Module({
  imports: [PostgresModule],
  providers: [TransactionContext, UnitOfWork],
  exports: [TransactionContext, UnitOfWork],
})
export class DatabaseModule {}
