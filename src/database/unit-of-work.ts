import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TransactionContext } from './transaction-context.js';

/**
 * Mở transaction cho thao tác ghi nhiều bảng/aggregate. Chỉ service được gọi.
 * Gọi lồng nhau dùng chung transaction bên ngoài. Không gọi API ngoài bên trong `fn`.
 */
@Injectable()
export class UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ctx: TransactionContext,
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.ctx.isActive) {
      return fn();
    }
    return this.dataSource.transaction((manager) =>
      this.ctx.runWith(manager, fn),
    );
  }
}
