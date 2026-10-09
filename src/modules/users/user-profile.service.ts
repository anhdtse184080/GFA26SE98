import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors/index.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import type { DesignerProfilePatch } from './entities/designer-profile.entity.js';
import type { SupplierProfilePatch } from './entities/supplier-profile.entity.js';
import type { User } from './entities/user.entity.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './repositories/user.repository.js';
import { roleCodeOf } from './role-code.enum.js';
import { UserAccountPolicy } from './user-account.policy.js';

/** `undefined` = giữ nguyên; `null` = xóa (chỉ field nullable, DTO đã chặn null cho field bắt buộc). */
export interface UpdateProfileInput {
  fullName?: string;
  phone?: string | null;
  designerProfile?: DesignerProfilePatch;
  supplierProfile?: SupplierProfilePatch;
}

/**
 * Sửa thông tin user và profile designer/supplier. Dùng chung cho Admin (`PATCH /admin/users/:id`)
 * và user tự sửa (`PATCH /users/me`); field nào được sửa do DTO của từng endpoint giới hạn.
 */
@Injectable()
export class UserProfileService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `PROFILE_NOT_ALLOWED_FOR_ROLE`
   * @throws ConflictError `EMPLOYEE_CODE_ALREADY_EXISTS` | `TAX_CODE_ALREADY_EXISTS`
   */
  async update(userId: string, input: UpdateProfileInput): Promise<User> {
    await this.uow.run(async () => {
      const user = await this.users.findByIdWithProfiles(userId);
      if (!user) {
        throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
      }
      UserAccountPolicy.assertProfilePatchMatchesRole(roleCodeOf(user.roleId), {
        designer: input.designerProfile !== undefined,
        supplier: input.supplierProfile !== undefined,
      });

      user.updateContact({ fullName: input.fullName, phone: input.phone });
      await this.users.save(user);

      if (input.designerProfile && user.designerProfile) {
        user.designerProfile.update(input.designerProfile);
        const saved = await this.users.saveDesignerProfileIfCodeAvailable(
          user.designerProfile,
        );
        if (!saved) {
          throw new ConflictError(
            'EMPLOYEE_CODE_ALREADY_EXISTS',
            'Mã nhân viên đã được sử dụng',
            { employeeCode: input.designerProfile.employeeCode },
          );
        }
      }

      if (input.supplierProfile && user.supplierProfile) {
        user.supplierProfile.update(input.supplierProfile);
        const saved = await this.users.saveSupplierProfileIfTaxCodeAvailable(
          user.supplierProfile,
        );
        if (!saved) {
          throw new ConflictError(
            'TAX_CODE_ALREADY_EXISTS',
            'Mã số thuế đã được sử dụng',
            { taxCode: input.supplierProfile.taxCode },
          );
        }
      }
    });
    return this.getWithProfiles(userId);
  }

  private async getWithProfiles(id: string): Promise<User> {
    const user = await this.users.findByIdWithProfiles(id);
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    return user;
  }
}
