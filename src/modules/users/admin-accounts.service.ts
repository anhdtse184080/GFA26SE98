import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { ConflictError, NotFoundError } from '../../common/errors/index.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { AccountInvitationService } from './account-invitation.service.js';
import type { User } from './entities/user.entity.js';
import {
  type NewDesignerProfile,
  type NewSupplierProfile,
  USER_REPOSITORY,
  type UserRepository,
} from './repositories/user.repository.js';
import { ROLE_IDS, type RoleCode } from './role-code.enum.js';
import { UserAccountPolicy } from './user-account.policy.js';

export type DesignerProfileInput = Omit<NewDesignerProfile, 'userId'>;

export type SupplierProfileInput = Omit<
  NewSupplierProfile,
  'userId' | 'partnershipStatus'
>;

export interface CreateAccountInput {
  /** Đã chuẩn hóa (trim + lowercase) ở DTO. */
  email: string;
  fullName: string;
  phone: string | null;
  /** Mọi role đều qua được DTO; policy chặn role Admin không được tạo. */
  role: RoleCode;
  designerProfile: DesignerProfileInput | null;
  supplierProfile: SupplierProfileInput | null;
}

/** Admin tạo tài khoản Staff/Designer/Supplier và gửi lại lời mời (DB_CONTEXT §6.1). */
@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger(AdminAccountsService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly invitation: AccountInvitationService,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * Tạo user INVITED (chưa có mật khẩu, `created_by` = Admin) kèm profile trong một transaction;
   * commit xong mới phát OTP và gửi email mời. Gửi email lỗi không làm hỏng việc tạo
   * (Admin gọi resend-invite).
   *
   * @throws BusinessRuleError `ROLE_NOT_ALLOWED` | `DESIGNER_PROFILE_REQUIRED` | `SUPPLIER_PROFILE_REQUIRED` | `PROFILE_NOT_ALLOWED_FOR_ROLE`
   * @throws ConflictError `EMAIL_ALREADY_EXISTS` | `EMPLOYEE_CODE_ALREADY_EXISTS` | `TAX_CODE_ALREADY_EXISTS`
   */
  async create(input: CreateAccountInput, admin: AuthUser): Promise<User> {
    const role = UserAccountPolicy.assertAdminCanCreate(input.role);
    UserAccountPolicy.assertProfileMatchesRole(role, {
      designer: input.designerProfile !== null,
      supplier: input.supplierProfile !== null,
    });

    const user = await this.uow.run(async () => {
      const created = await this.users.createIfEmailAvailable({
        roleId: ROLE_IDS[role],
        email: input.email,
        passwordHash: null,
        fullName: input.fullName,
        phone: input.phone,
        status: 'INVITED',
        createdById: admin.id,
      });
      if (!created) {
        throw new ConflictError(
          'EMAIL_ALREADY_EXISTS',
          'Email đã được sử dụng',
        );
      }

      if (input.designerProfile) {
        const profile = await this.users.createDesignerProfileIfCodeAvailable({
          ...input.designerProfile,
          userId: created.id,
        });
        if (!profile) {
          throw new ConflictError(
            'EMPLOYEE_CODE_ALREADY_EXISTS',
            'Mã nhân viên đã được sử dụng',
            { employeeCode: input.designerProfile.employeeCode },
          );
        }
      }

      if (input.supplierProfile) {
        const profile =
          await this.users.createSupplierProfileIfTaxCodeAvailable({
            ...input.supplierProfile,
            userId: created.id,
            partnershipStatus: 'ACTIVE',
          });
        if (!profile) {
          throw new ConflictError(
            'TAX_CODE_ALREADY_EXISTS',
            'Mã số thuế đã được sử dụng',
            { taxCode: input.supplierProfile.taxCode },
          );
        }
      }
      return created;
    });

    try {
      await this.invitation.send(user);
    } catch (error) {
      this.logger.error(
        `Không gửi được email mời cho user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return this.getWithProfiles(user.id);
  }

  /**
   * Gửi lại email mời (OTP mới) cho tài khoản do Admin tạo, còn INVITED và chưa có mật khẩu.
   *
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `INVITATION_NOT_PENDING`
   * @throws TooManyRequestsError `OTP_RESEND_TOO_SOON`
   */
  async resendInvite(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    UserAccountPolicy.assertCanResendInvite(user);
    await this.invitation.resend(user);
  }

  private async getWithProfiles(id: string): Promise<User> {
    const user = await this.users.findByIdWithProfiles(id);
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    return user;
  }
}
