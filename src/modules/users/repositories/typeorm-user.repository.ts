import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../../database/transaction-context.js';
import { User } from '../entities/user.entity.js';
import type { NewUser, UserRepository } from './user.repository.js';

@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(User);
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  findByIdWithProfiles(id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { designerProfile: true, supplierProfile: true },
    });
  }

  async createIfEmailAvailable(user: NewUser): Promise<User | null> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(User)
      .values(user)
      .orIgnore()
      .returning(['id'])
      .execute();
    const rows = result.raw as { id: string }[];
    return rows.length > 0 ? this.findById(rows[0].id) : null;
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }
}
