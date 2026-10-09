import type { DataSource, EntityManager } from 'typeorm';
import { TransactionContext } from '../transaction-context.js';
import { UnitOfWork } from '../unit-of-work.js';

function createFakeDataSource() {
  const defaultManager = { name: 'default' } as unknown as EntityManager;
  const txManager = { name: 'tx' } as unknown as EntityManager;
  const transaction = vi.fn((cb: (m: EntityManager) => Promise<unknown>) =>
    cb(txManager),
  );
  const dataSource = {
    manager: defaultManager,
    transaction,
  } as unknown as DataSource;
  return { dataSource, defaultManager, txManager, transaction };
}

describe('UnitOfWork', () => {
  it('cung cấp manager của transaction bên trong run và manager mặc định bên ngoài', async () => {
    const { dataSource, defaultManager, txManager } = createFakeDataSource();
    const ctx = new TransactionContext(dataSource);
    const uow = new UnitOfWork(dataSource, ctx);

    expect(ctx.manager).toBe(defaultManager);
    const inside = await uow.run(() => Promise.resolve(ctx.manager));

    expect(inside).toBe(txManager);
    expect(ctx.manager).toBe(defaultManager);
    expect(ctx.isActive).toBe(false);
  });

  it('gọi lồng nhau chỉ mở một transaction', async () => {
    const { dataSource, txManager, transaction } = createFakeDataSource();
    const ctx = new TransactionContext(dataSource);
    const uow = new UnitOfWork(dataSource, ctx);

    const inner = await uow.run(() =>
      uow.run(() => Promise.resolve(ctx.manager)),
    );

    expect(inner).toBe(txManager);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('ném lại lỗi từ fn', async () => {
    const { dataSource } = createFakeDataSource();
    const uow = new UnitOfWork(dataSource, new TransactionContext(dataSource));

    await expect(
      uow.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});
