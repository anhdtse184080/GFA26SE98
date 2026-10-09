import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { NotFoundError } from '../../common/errors/index.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import type { User } from './entities/user.entity.js';
import {
  type PageRequest,
  USER_REPOSITORY,
  type UserRepository,
} from './repositories/user.repository.js';
import { ROLE_IDS, type RoleCode } from './role-code.enum.js';
import { UserAccountPolicy } from './user-account.policy.js';
import {
  USER_STATUS_ACTION_RULES,
  type UserStatus,
  type UserStatusAction,
} from './user-status.js';

export interface ListUsersInput extends PageRequest {
  role?: RoleCode;
  status?: UserStatus;
  keyword?: string;
}

/** Admin xem danh sách, khóa/mở khóa/vô hiệu hóa tài khoản, bật/tắt designer (DB_CONTEXT §6.1). Không xóa cứng. */
@Injectable()
export class UserManagementService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly uow: UnitOfWork,
  ) {}

  list(input: ListUsersInput): Promise<Paginated<User>> {
    return this.users.search(
      {
        roleId: input.role === undefined ? undefined : ROLE_IDS[input.role],
        status: input.status,
        keyword: input.keyword || undefined,
      },
      { page: input.page, limit: input.limit },
    );
  }

  /** @throws NotFoundError `USER_NOT_FOUND` */
  async getDetail(id: string): Promise<User> {
    const user = await this.users.findByIdWithProfiles(id);
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    return user;
  }

  /**
   * Token đang dùng của user bị khóa/vô hiệu hóa bị từ chối ở request kế tiếp (JwtStrategy kiểm tra lại DB).
   *
   * Khóa/vô hiệu hóa một Admin: khóa các dòng Admin ACTIVE trước rồi mới đọc lại và đếm,
   * nên hai Admin khóa nhau đồng thời không làm hệ thống mất Admin ACTIVE cuối cùng.
   *
   * @throws ForbiddenError `CANNOT_CHANGE_OWN_STATUS`
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `INVALID_USER_STATUS_TRANSITION` | `LAST_ACTIVE_ADMIN`
   */
  async changeStatus(
    id: string,
    action: UserStatusAction,
    admin: AuthUser,
  ): Promise<User> {
    UserAccountPolicy.assertNotSelf(id, admin.id);
    return this.uow.run(async () => {
      let user = await this.findOrThrow(id);
      const removesActive = USER_STATUS_ACTION_RULES[action].to !== 'ACTIVE';
      if (removesActive && user.roleId === ROLE_IDS.ADMIN) {
        const activeAdmins = await this.users.countActiveAdminsForUpdate();
        user = await this.findOrThrow(id); // đọc lại sau khi giữ khóa
        if (user.status === 'ACTIVE') {
          UserAccountPolicy.assertNotLastActiveAdmin(activeAdmins);
        }
      }
      user.applyStatusAction(action);
      return this.users.save(user);
    });
  }

  private async findOrThrow(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    return user;
  }

  /** @throws NotFoundError `DESIGNER_NOT_FOUND` */
  async setDesignerAvailability(
    id: string,
    isAvailable: boolean,
  ): Promise<User> {
    const user = await this.users.findByIdWithProfiles(id);
    if (!user?.designerProfile) {
      throw new NotFoundError('DESIGNER_NOT_FOUND', 'Không tìm thấy designer');
    }
    user.designerProfile.setAvailability(isAvailable);
    await this.users.saveDesignerProfileIfCodeAvailable(user.designerProfile);
    return user;
  }
}
