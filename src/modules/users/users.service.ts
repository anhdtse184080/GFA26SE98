import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors/index.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import type { User } from './entities/user.entity.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './repositories/user.repository.js';
import { ROLE_IDS } from './role-code.enum.js';
import { UserAccountPolicy } from './user-account.policy.js';

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

  /**
   * Tìm customer để mời vào dự án: role CUSTOMER, tự đăng ký (`created_by = null`), ACTIVE.
   * `email` phải đã chuẩn hóa (trim + lowercase).
   *
   * TODO(projects): ProjectsService.inviteCustomer(projectId, email, actor) gọi method này (DB_CONTEXT §6 quy tắc 1):
   *  - Staff chỉ mời vào dự án mình phụ trách (`projects.staff_id = actor.id`); Admin mời được mọi dự án.
   *  - Gán `projects.customer_id`; phải bằng `apartments.owner_id` của `projects.apartment_id` (ràng buộc toàn vẹn §6).
   *  - Không tạo tài khoản customer hộ: email chưa đăng ký → `USER_NOT_FOUND`, chưa xác thực → `USER_NOT_ACTIVE`.
   *
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `USER_NOT_ACTIVE`
   */
  async findInvitableCustomerByEmail(email: string): Promise<User> {
    return UserAccountPolicy.assertInvitableCustomer(
      await this.users.findByEmail(email),
    );
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

  /** @throws BusinessRuleError `INVALID_USER_STATUS_TRANSITION` nếu user không ở INVITED */
  async acceptInvitation(user: User, passwordHash: string): Promise<User> {
    user.acceptInvitation(passwordHash, this.clock.now());
    return this.users.save(user);
  }

  async recordLogin(user: User): Promise<User> {
    user.recordLogin(this.clock.now());
    return this.users.save(user);
  }

  async changePassword(user: User, passwordHash: string): Promise<User> {
    user.changePassword(passwordHash);
    return this.users.save(user);
  }
}
