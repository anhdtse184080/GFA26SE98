import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  ROLE_DISPLAY_NAMES,
  ROLE_IDS,
  type RoleCode,
  roleCodeOf,
} from '../../common/auth/role-code.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import { staffInvitationEmail } from '../../common/mail-templates/staff-invitation.template.js';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import { MAILER, type Mailer } from '../../common/ports/mailer.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { OtpService } from '../otp/otp.service.js';
import type { DesignerProfilePatch } from './entities/designer-profile.entity.js';
import type { SupplierProfilePatch } from './entities/supplier-profile.entity.js';
import {
  USER_STATUS_ACTION_RULES,
  type User,
  type UserStatus,
  type UserStatusAction,
} from './entities/user.entity.js';
import {
  type NewDesignerProfile,
  type NewSupplierProfile,
  UsersRepository,
} from './users.repository.js';

/** Các role Admin được tạo tài khoản (DB_CONTEXT §6.1). CUSTOMER chỉ tự đăng ký, ADMIN chỉ seed. */
const ADMIN_CREATABLE_ROLES = ['STAFF', 'DESIGNER', 'SUPPLIER'] as const;

type AdminCreatableRole = (typeof ADMIN_CREATABLE_ROLES)[number];

export interface RegisterCustomerInput {
  /** Đã chuẩn hóa (trim + lowercase). */
  email: string;
  fullName: string;
  phone: string | null;
  passwordHash: string;
}

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
  /** Mọi role đều qua được DTO; service chặn role Admin không được tạo. */
  role: RoleCode;
  designerProfile: DesignerProfileInput | null;
  supplierProfile: SupplierProfileInput | null;
}

export interface ListUsersInput extends PageRequest {
  role?: RoleCode;
  status?: UserStatus;
  keyword?: string;
}

/** `undefined` = giữ nguyên; `null` = xóa (chỉ field nullable, DTO đã chặn null cho field bắt buộc). */
export interface UpdateProfileInput {
  fullName?: string;
  phone?: string | null;
  designerProfile?: DesignerProfilePatch;
  supplierProfile?: SupplierProfilePatch;
}

/**
 * Tài khoản (DB_CONTEXT §6.1): dữ liệu user cho module khác (auth, projects), Admin tạo tài khoản
 * Staff/Designer/Supplier và gửi lời mời, quản lý trạng thái, sửa thông tin và profile.
 * Không xóa cứng tài khoản.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly users: UsersRepository,
    private readonly otp: OtpService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MAILER) private readonly mailer: Mailer,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.frontendUrl = config.get('FRONTEND_URL', { infer: true });
  }

  // ---------- Đọc ----------

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  /** `email` phải đã chuẩn hóa (trim + lowercase). */
  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  /** User kèm profile designer/supplier. @throws NotFoundError `USER_NOT_FOUND` */
  async getWithProfiles(id: string): Promise<User> {
    return this.orNotFound(await this.users.findByIdWithProfiles(id));
  }

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

  /**
   * Tìm customer để mời vào dự án: role CUSTOMER, tự đăng ký (`created_by = null`), ACTIVE.
   * Email không thuộc customer tự đăng ký coi như không tìm thấy. `email` phải đã chuẩn hóa.
   *
   * TODO(projects): ProjectsService.inviteCustomer(projectId, email, actor) gọi method này (DB_CONTEXT §6 quy tắc 1):
   *  - Staff chỉ mời vào dự án mình phụ trách (`projects.staff_id = actor.id`); Admin mời được mọi dự án.
   *  - Gán `projects.customer_id`; phải bằng `apartments.owner_id` của `projects.apartment_id` (ràng buộc toàn vẹn §6).
   *
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `USER_NOT_ACTIVE`
   */
  async findInvitableCustomerByEmail(email: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (
      !user ||
      user.roleId !== ROLE_IDS.CUSTOMER ||
      user.createdById !== null
    ) {
      throw new NotFoundError(
        'USER_NOT_FOUND',
        'Email chưa đăng ký tài khoản khách hàng',
      );
    }
    if (user.status !== 'ACTIVE') {
      throw new BusinessRuleError(
        'USER_NOT_ACTIVE',
        'Tài khoản khách hàng chưa hoạt động (chưa xác thực email hoặc đã bị khóa)',
        { status: user.status },
      );
    }
    return user;
  }

  // ---------- Đăng ký, kích hoạt, mật khẩu, phiên (gọi từ auth) ----------

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

  /** Đổi mật khẩu; phiên hiện tại bị thu hồi. */
  async changePassword(user: User, passwordHash: string): Promise<User> {
    user.changePassword(passwordHash);
    return this.users.save(user);
  }

  /** Mở phiên đăng nhập mới, thay phiên cũ. */
  async startSession(
    user: User,
    sessionId: string,
    refreshTokenHash: string,
  ): Promise<User> {
    user.startSession(sessionId, refreshTokenHash);
    return this.users.save(user);
  }

  /** Xoay refresh token của phiên; `false` nếu `expectedHash` không còn là hash hiện tại. */
  rotateRefreshToken(
    userId: string,
    sessionId: string,
    expectedHash: string,
    newHash: string,
  ): Promise<boolean> {
    return this.users.rotateRefreshTokenHash(
      userId,
      sessionId,
      expectedHash,
      newHash,
    );
  }

  async revokeSession(user: User): Promise<User> {
    user.revokeSession();
    return this.users.save(user);
  }

  // ---------- Admin tạo tài khoản, lời mời ----------

  /**
   * Tạo user INVITED (chưa có mật khẩu, `created_by` = Admin) kèm profile trong một transaction;
   * commit xong mới phát OTP và gửi email mời. Gửi email lỗi không làm hỏng việc tạo
   * (Admin gọi `POST /admin/users/:id/invitations`).
   *
   * @throws BusinessRuleError `ROLE_NOT_ALLOWED` | `DESIGNER_PROFILE_REQUIRED` | `SUPPLIER_PROFILE_REQUIRED` | `PROFILE_NOT_ALLOWED_FOR_ROLE`
   * @throws ConflictError `EMAIL_ALREADY_EXISTS` | `EMPLOYEE_CODE_ALREADY_EXISTS` | `TAX_CODE_ALREADY_EXISTS`
   */
  async createAccount(
    input: CreateAccountInput,
    admin: AuthUser,
  ): Promise<User> {
    const role = this.assertAdminCanCreate(input.role);
    this.assertProfileMatchesRole(role, input);

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
          throw this.employeeCodeTaken(input.designerProfile.employeeCode);
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
          throw this.taxCodeTaken(input.supplierProfile.taxCode);
        }
      }
      return created;
    });

    try {
      await this.sendInvitation(user);
    } catch (error) {
      this.logger.error(
        `Không gửi được email mời cho user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return this.getWithProfiles(user.id);
  }

  /**
   * Gửi lại email mời (OTP mới, tôn trọng cooldown) cho tài khoản do Admin tạo, còn INVITED
   * và chưa có mật khẩu. Không gọi bên trong `UnitOfWork.run` (gửi email).
   *
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `INVITATION_NOT_PENDING`
   * @throws TooManyRequestsError `OTP_RESEND_TOO_SOON`
   */
  async resendInvite(userId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (user.activationMethod() !== 'INVITATION') {
      throw new BusinessRuleError(
        'INVITATION_NOT_PENDING',
        'Chỉ gửi lại lời mời cho tài khoản do Admin tạo và chưa kích hoạt',
        { status: user.status },
      );
    }
    await this.otp.assertCanResend(user.id, 'ACCOUNT_ACTIVATION');
    await this.sendInvitation(user);
  }

  // ---------- Admin quản lý trạng thái ----------

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
    if (id === admin.id) {
      throw new ForbiddenError(
        'CANNOT_CHANGE_OWN_STATUS',
        'Không thể tự thay đổi trạng thái tài khoản của chính mình',
      );
    }
    return this.uow.run(async () => {
      let user = await this.getUser(id);
      const removesActive = USER_STATUS_ACTION_RULES[action].to !== 'ACTIVE';
      if (removesActive && user.roleId === ROLE_IDS.ADMIN) {
        const activeAdmins = await this.users.countActiveAdminsForUpdate();
        user = await this.getUser(id); // đọc lại sau khi giữ khóa
        // `activeAdmins` tính cả admin sắp bị khóa: luôn phải còn ít nhất một Admin ACTIVE.
        if (user.status === 'ACTIVE' && activeAdmins <= 1) {
          throw new BusinessRuleError(
            'LAST_ACTIVE_ADMIN',
            'Không thể khóa hoặc vô hiệu hóa Admin đang hoạt động cuối cùng',
          );
        }
      }
      user.applyStatusAction(action);
      return this.users.save(user);
    });
  }

  /**
   * @throws NotFoundError `DESIGNER_NOT_FOUND`
   * @throws ConflictError `EMPLOYEE_CODE_ALREADY_EXISTS` (không xảy ra trừ khi dữ liệu đã trùng sẵn)
   */
  async setDesignerAvailability(
    id: string,
    isAvailable: boolean,
  ): Promise<User> {
    const user = await this.users.findByIdWithProfiles(id);
    if (!user?.designerProfile) {
      throw new NotFoundError('DESIGNER_NOT_FOUND', 'Không tìm thấy designer');
    }
    user.designerProfile.setAvailability(isAvailable);
    const saved = await this.users.saveDesignerProfileIfCodeAvailable(
      user.designerProfile,
    );
    if (!saved) throw this.employeeCodeTaken(user.designerProfile.employeeCode);
    return user;
  }

  // ---------- Sửa thông tin và profile ----------

  /**
   * Dùng chung cho Admin (`PATCH /admin/users/:id`) và user tự sửa (`PATCH /users/me`);
   * field nào được sửa do DTO của từng endpoint giới hạn.
   *
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `PROFILE_NOT_ALLOWED_FOR_ROLE`
   * @throws ConflictError `EMPLOYEE_CODE_ALREADY_EXISTS` | `TAX_CODE_ALREADY_EXISTS`
   */
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<User> {
    await this.uow.run(async () => {
      const user = await this.getWithProfiles(userId);
      this.assertProfilesAllowedForRole(roleCodeOf(user.roleId), {
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
          throw this.employeeCodeTaken(input.designerProfile.employeeCode);
        }
      }

      if (input.supplierProfile && user.supplierProfile) {
        user.supplierProfile.update(input.supplierProfile);
        const saved = await this.users.saveSupplierProfileIfTaxCodeAvailable(
          user.supplierProfile,
        );
        if (!saved) throw this.taxCodeTaken(input.supplierProfile.taxCode);
      }
    });
    return this.getWithProfiles(userId);
  }

  // ---------- Private ----------

  /** @throws NotFoundError `USER_NOT_FOUND` */
  private async getUser(id: string): Promise<User> {
    return this.orNotFound(await this.users.findById(id));
  }

  private orNotFound(user: User | null): User {
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    return user;
  }

  /** Phát OTP lời mời (vô hiệu OTP cũ) rồi gửi email kèm link `FRONTEND_URL/accept-invite`. */
  private async sendInvitation(user: User): Promise<void> {
    const code = await this.otp.issue(user.id, 'ACCOUNT_ACTIVATION', {
      invitation: true,
    });
    const mail = staffInvitationEmail({
      fullName: user.fullName,
      roleName: ROLE_DISPLAY_NAMES[roleCodeOf(user.roleId)],
      email: user.email,
      otp: code,
      expiresInHours: this.otp.inviteTtlHours,
      frontendUrl: this.frontendUrl,
    });
    await this.mailer.send({ to: user.email, ...mail });
  }

  /** @throws BusinessRuleError `ROLE_NOT_ALLOWED` */
  private assertAdminCanCreate(role: RoleCode): AdminCreatableRole {
    if (!(ADMIN_CREATABLE_ROLES as readonly RoleCode[]).includes(role)) {
      throw new BusinessRuleError(
        'ROLE_NOT_ALLOWED',
        'Admin chỉ được tạo tài khoản STAFF, DESIGNER hoặc SUPPLIER',
        { role, allowedRoles: ADMIN_CREATABLE_ROLES },
      );
    }
    return role as AdminCreatableRole;
  }

  /**
   * DESIGNER bắt buộc `designerProfile`, SUPPLIER bắt buộc `supplierProfile`; không gửi profile lệch role.
   *
   * @throws BusinessRuleError `DESIGNER_PROFILE_REQUIRED` | `SUPPLIER_PROFILE_REQUIRED` | `PROFILE_NOT_ALLOWED_FOR_ROLE`
   */
  private assertProfileMatchesRole(
    role: AdminCreatableRole,
    input: CreateAccountInput,
  ): void {
    const profiles = {
      designer: input.designerProfile !== null,
      supplier: input.supplierProfile !== null,
    };
    if (role === 'DESIGNER' && !profiles.designer) {
      throw new BusinessRuleError(
        'DESIGNER_PROFILE_REQUIRED',
        'Tài khoản DESIGNER bắt buộc có designerProfile',
      );
    }
    if (role === 'SUPPLIER' && !profiles.supplier) {
      throw new BusinessRuleError(
        'SUPPLIER_PROFILE_REQUIRED',
        'Tài khoản SUPPLIER bắt buộc có supplierProfile',
      );
    }
    this.assertProfilesAllowedForRole(role, profiles);
  }

  /**
   * Chỉ DESIGNER gửi `designerProfile`, chỉ SUPPLIER gửi `supplierProfile`.
   *
   * @throws BusinessRuleError `PROFILE_NOT_ALLOWED_FOR_ROLE`
   */
  private assertProfilesAllowedForRole(
    role: RoleCode,
    profiles: { designer: boolean; supplier: boolean },
  ): void {
    const unexpected = [
      profiles.designer && role !== 'DESIGNER' ? 'designerProfile' : null,
      profiles.supplier && role !== 'SUPPLIER' ? 'supplierProfile' : null,
    ].filter((field) => field !== null);
    if (unexpected.length > 0) {
      throw new BusinessRuleError(
        'PROFILE_NOT_ALLOWED_FOR_ROLE',
        `Role ${role} không dùng ${unexpected.join(', ')}`,
        { role, fields: unexpected },
      );
    }
  }

  private employeeCodeTaken(employeeCode: string | undefined): ConflictError {
    return new ConflictError(
      'EMPLOYEE_CODE_ALREADY_EXISTS',
      'Mã nhân viên đã được sử dụng',
      { employeeCode },
    );
  }

  private taxCodeTaken(taxCode: string | undefined): ConflictError {
    return new ConflictError(
      'TAX_CODE_ALREADY_EXISTS',
      'Mã số thuế đã được sử dụng',
      { taxCode },
    );
  }
}
