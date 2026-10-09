import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors/index.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import type { User } from './entities/user.entity.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './repositories/user.repository.js';
import { ROLE_IDS } from './role-code.enum.js';

export interface RegisterCustomerInput {
  /** Đã chuẩn hóa (trim + lowercase). */
  email: string;
  fullName: string;
  phone: string | null;
  passwordHash: string;
}

/** Dữ liệu tài khoản cho các module khác. Không kiểm tra quyền người gọi. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  /** @throws NotFoundError `USER_NOT_FOUND` */
  async getWithProfiles(id: string): Promise<User> {
    const user = await this.users.findByIdWithProfiles(id);
    if (!user)
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    return user;
  }

  /**
   * Customer tự đăng ký: luôn role CUSTOMER, INVITED, `created_by = null`.
   * @throws ConflictError `EMAIL_ALREADY_EXISTS` khi email bị chiếm (kể cả do request đồng thời)
   */
  async registerCustomer(input: RegisterCustomerInput): Promise<User> {
    const user = await this.users.createIfEmailAvailable({
      roleId: ROLE_IDS.CUSTOMER,
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      phone: input.phone,
      status: 'INVITED',
      createdById: null,
    });
    if (!user) {
      throw new ConflictError('EMAIL_ALREADY_EXISTS', 'Email đã được sử dụng');
    }
    return user;
  }

  /** @throws BusinessRuleError `INVALID_USER_STATUS_TRANSITION` nếu user không ở INVITED */
  async activate(user: User): Promise<User> {
    user.activate(this.clock.now());
    return this.users.save(user);
  }

  async recordLogin(user: User): Promise<User> {
    user.recordLogin(this.clock.now());
    return this.users.save(user);
  }
}
