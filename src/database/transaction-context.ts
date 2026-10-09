import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Giữ EntityManager của transaction hiện tại (AsyncLocalStorage).
 * Repository lấy `manager` từ đây nên tự tham gia transaction đang mở, không cần truyền tham số.
 */
@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  constructor(private readonly dataSource: DataSource) {}

  get manager(): EntityManager {
    return this.storage.getStore() ?? this.dataSource.manager;
  }

  get isActive(): boolean {
    return this.storage.getStore() !== undefined;
  }

  runWith<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(manager, fn);
  }
}
