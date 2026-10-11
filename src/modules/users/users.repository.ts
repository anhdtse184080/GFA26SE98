import { Injectable } from '@nestjs/common';
import { ROLE_IDS } from '../../common/auth/role-code.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { DesignerProfile } from './entities/designer-profile.entity.js';
import { SupplierProfile } from './entities/supplier-profile.entity.js';
import { User, type UserStatus } from './entities/user.entity.js';

export type NewUser = Pick<
  User,
  | 'roleId'
  | 'email'
  | 'passwordHash'
  | 'fullName'
  | 'phone'
  | 'status'
  | 'createdById'
>;

export type NewDesignerProfile = Pick<
  DesignerProfile,
  | 'userId'
  | 'employeeCode'
  | 'title'
  | 'specialization'
  | 'yearsOfExperience'
  | 'bio'
>;

export type NewSupplierProfile = Pick<
  SupplierProfile,
  | 'userId'
  | 'companyName'
  | 'taxCode'
  | 'businessAddress'
  | 'contactName'
  | 'contactPhone'
  | 'website'
  | 'partnershipStatus'
  | 'partnerSince'
>;

export interface UserSearchFilter {
  roleId?: number;
  status?: UserStatus;
  /** Tìm trong email hoặc họ tên, không phân biệt hoa thường. */
  keyword?: string;
}

export interface PageRequest {
  page: number;
  limit: number;
}

/** Escape ký tự đặc biệt của LIKE (`\`, `%`, `_`). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `users` + `designer_profiles`, `supplier_profiles` (ghi cùng user). Không có `delete`: không xóa cứng tài khoản. */
@Injectable()
export class UsersRepository {
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

  async createDesignerProfileIfCodeAvailable(
    profile: NewDesignerProfile,
  ): Promise<DesignerProfile | null> {
    const repo = this.tx.manager.getRepository(DesignerProfile);
    const result = await repo
      .createQueryBuilder()
      .insert()
      .values(profile)
      .orIgnore()
      .returning(['user_id'])
      .execute();
    return (result.raw as unknown[]).length > 0
      ? repo.findOne({ where: { userId: profile.userId } })
      : null;
  }

  async createSupplierProfileIfTaxCodeAvailable(
    profile: NewSupplierProfile,
  ): Promise<SupplierProfile | null> {
    const repo = this.tx.manager.getRepository(SupplierProfile);
    const result = await repo
      .createQueryBuilder()
      .insert()
      .values(profile)
      .orIgnore()
      .returning(['user_id'])
      .execute();
    return (result.raw as unknown[]).length > 0
      ? repo.findOne({ where: { userId: profile.userId } })
      : null;
  }

  async countActiveAdminsForUpdate(): Promise<number> {
    // Postgres không cho FOR UPDATE cùng COUNT(*): khóa từng dòng rồi đếm.
    const rows = await this.repo
      .createQueryBuilder('u')
      .select('u.id')
      .where('u.roleId = :roleId', { roleId: ROLE_IDS.ADMIN })
      .andWhere('u.status = :status', { status: 'ACTIVE' })
      .setLock('pessimistic_write')
      .getMany();
    return rows.length;
  }

  async search(
    filter: UserSearchFilter,
    page: PageRequest,
  ): Promise<Paginated<User>> {
    const qb = this.repo.createQueryBuilder('u');
    if (filter.roleId !== undefined) {
      qb.andWhere('u.roleId = :roleId', { roleId: filter.roleId });
    }
    if (filter.status !== undefined) {
      qb.andWhere('u.status = :status', { status: filter.status });
    }
    if (filter.keyword) {
      qb.andWhere('(u.email ILIKE :keyword OR u.fullName ILIKE :keyword)', {
        keyword: `%${escapeLike(filter.keyword)}%`,
      });
    }
    const [items, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .skip((page.page - 1) * page.limit)
      .take(page.limit)
      .getManyAndCount();
    return { items, page: page.page, limit: page.limit, total };
  }

  async saveDesignerProfileIfCodeAvailable(
    profile: DesignerProfile,
  ): Promise<DesignerProfile | null> {
    try {
      return await this.tx.manager.getRepository(DesignerProfile).save(profile);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_designer_profiles_employee_code')) {
        return null;
      }
      throw error;
    }
  }

  async saveSupplierProfileIfTaxCodeAvailable(
    profile: SupplierProfile,
  ): Promise<SupplierProfile | null> {
    try {
      return await this.tx.manager.getRepository(SupplierProfile).save(profile);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_supplier_profiles_tax_code')) {
        return null;
      }
      throw error;
    }
  }

  async rotateRefreshTokenHash(
    userId: string,
    sessionId: string,
    expectedHash: string,
    newHash: string,
  ): Promise<boolean> {
    const result = await this.repo.update(
      { id: userId, sessionId, refreshTokenHash: expectedHash },
      { refreshTokenHash: newHash },
    );
    return (result.affected ?? 0) > 0;
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }
}
