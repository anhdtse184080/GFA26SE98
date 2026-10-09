import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import { ROLE_IDS, type RoleCode } from './role-code.enum.js';
import type { UserStatus } from './user-status.js';

/** Các role Admin được tạo tài khoản (DB_CONTEXT §6.1). CUSTOMER chỉ tự đăng ký, ADMIN chỉ seed. */
export const ADMIN_CREATABLE_ROLES = ['STAFF', 'DESIGNER', 'SUPPLIER'] as const;

export type AdminCreatableRole = (typeof ADMIN_CREATABLE_ROLES)[number];

/**
 * Cách một tài khoản INVITED trở thành ACTIVE:
 * - `SELF_REGISTRATION`: customer tự đăng ký (đã có mật khẩu) → `/auth/verify-email`
 * - `INVITATION`: Admin tạo (chưa có mật khẩu) → `/auth/accept-invite`
 */
export type ActivationMethod = 'SELF_REGISTRATION' | 'INVITATION';

export interface AccountState {
  status: UserStatus;
  passwordHash: string | null;
}

export interface InvitableCandidate {
  roleId: number;
  status: UserStatus;
  createdById: string | null;
}

export interface ProfileInput {
  designer: boolean;
  supplier: boolean;
}

/** Quy tắc tạo và kích hoạt tài khoản, thuần (không I/O). */
export const UserAccountPolicy = {
  /** Trả role đã thu hẹp về `AdminCreatableRole`. @throws BusinessRuleError `ROLE_NOT_ALLOWED` */
  assertAdminCanCreate(role: RoleCode): AdminCreatableRole {
    if (!(ADMIN_CREATABLE_ROLES as readonly RoleCode[]).includes(role)) {
      throw new BusinessRuleError(
        'ROLE_NOT_ALLOWED',
        'Admin chỉ được tạo tài khoản STAFF, DESIGNER hoặc SUPPLIER',
        { role, allowedRoles: ADMIN_CREATABLE_ROLES },
      );
    }
    return role as AdminCreatableRole;
  },

  /**
   * DESIGNER bắt buộc `designerProfile`, SUPPLIER bắt buộc `supplierProfile`; không gửi profile lệch role.
   *
   * @throws BusinessRuleError `DESIGNER_PROFILE_REQUIRED` | `SUPPLIER_PROFILE_REQUIRED` | `PROFILE_NOT_ALLOWED_FOR_ROLE`
   */
  assertProfileMatchesRole(
    role: AdminCreatableRole,
    profiles: ProfileInput,
  ): void {
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
    UserAccountPolicy.assertProfilePatchMatchesRole(role, profiles);
  },

  /**
   * Sửa profile: chỉ DESIGNER gửi `designerProfile`, chỉ SUPPLIER gửi `supplierProfile`.
   *
   * @throws BusinessRuleError `PROFILE_NOT_ALLOWED_FOR_ROLE`
   */
  assertProfilePatchMatchesRole(role: RoleCode, profiles: ProfileInput): void {
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
  },

  /** Admin không tự khóa / vô hiệu hóa chính mình. @throws ForbiddenError `CANNOT_CHANGE_OWN_STATUS` */
  assertNotSelf(targetUserId: string, adminId: string): void {
    if (targetUserId === adminId) {
      throw new ForbiddenError(
        'CANNOT_CHANGE_OWN_STATUS',
        'Không thể tự thay đổi trạng thái tài khoản của chính mình',
      );
    }
  },

  /**
   * Chỉ mời được vào dự án tài khoản customer tự đăng ký (`created_by = null`) và đã ACTIVE (DB_CONTEXT §6.1).
   * Email không thuộc customer tự đăng ký coi như không tìm thấy. Trả lại `user` đã chắc chắn khác null.
   *
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `USER_NOT_ACTIVE`
   */
  assertInvitableCustomer<T extends InvitableCandidate>(user: T | null): T {
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
  },

  /**
   * Luôn phải còn ít nhất một Admin ACTIVE. `activeAdminCount` tính cả admin sắp bị khóa.
   *
   * @throws BusinessRuleError `LAST_ACTIVE_ADMIN`
   */
  assertNotLastActiveAdmin(activeAdminCount: number): void {
    if (activeAdminCount <= 1) {
      throw new BusinessRuleError(
        'LAST_ACTIVE_ADMIN',
        'Không thể khóa hoặc vô hiệu hóa Admin đang hoạt động cuối cùng',
      );
    }
  },

  /** Tài khoản còn chờ kích hoạt theo cách nào; `null` nếu không còn INVITED. */
  activationMethod(user: AccountState): ActivationMethod | null {
    if (user.status !== 'INVITED') return null;
    return user.passwordHash === null ? 'INVITATION' : 'SELF_REGISTRATION';
  },

  /**
   * `/auth/verify-email` chỉ dành cho customer tự đăng ký.
   *
   * @throws ConflictError `EMAIL_ALREADY_VERIFIED`
   * @throws ForbiddenError `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   * @throws BusinessRuleError `ACCEPT_INVITE_REQUIRED`
   */
  assertCanVerifyEmail(user: AccountState): void {
    if (user.status === 'ACTIVE') {
      throw new ConflictError(
        'EMAIL_ALREADY_VERIFIED',
        'Email đã được xác thực, vui lòng đăng nhập',
      );
    }
    assertNotBlocked(user.status);
    if (UserAccountPolicy.activationMethod(user) === 'INVITATION') {
      throw new BusinessRuleError(
        'ACCEPT_INVITE_REQUIRED',
        'Tài khoản được mời, vui lòng kích hoạt qua /auth/accept-invite',
        { acceptInviteEndpoint: '/auth/accept-invite' },
      );
    }
  },

  /**
   * `/auth/accept-invite` chỉ dành cho tài khoản Admin tạo, còn INVITED và chưa có mật khẩu.
   *
   * @throws ConflictError `INVITATION_ALREADY_ACCEPTED`
   * @throws ForbiddenError `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   * @throws BusinessRuleError `VERIFY_EMAIL_REQUIRED`
   */
  assertCanAcceptInvite(user: AccountState): void {
    if (user.status === 'ACTIVE') {
      throw new ConflictError(
        'INVITATION_ALREADY_ACCEPTED',
        'Tài khoản đã được kích hoạt, vui lòng đăng nhập',
      );
    }
    assertNotBlocked(user.status);
    if (UserAccountPolicy.activationMethod(user) === 'SELF_REGISTRATION') {
      throw new BusinessRuleError(
        'VERIFY_EMAIL_REQUIRED',
        'Tài khoản tự đăng ký, vui lòng xác thực qua /auth/verify-email',
        { verifyEmailEndpoint: '/auth/verify-email' },
      );
    }
  },

  /** @throws BusinessRuleError `INVITATION_NOT_PENDING` */
  assertCanResendInvite(user: AccountState): void {
    if (UserAccountPolicy.activationMethod(user) !== 'INVITATION') {
      throw new BusinessRuleError(
        'INVITATION_NOT_PENDING',
        'Chỉ gửi lại lời mời cho tài khoản do Admin tạo và chưa kích hoạt',
        { status: user.status },
      );
    }
  },
};

/** LOCKED / INACTIVE không được kích hoạt bằng OTP. */
function assertNotBlocked(status: UserStatus): void {
  if (status === 'LOCKED') {
    throw new ForbiddenError('ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
  }
  if (status === 'INACTIVE') {
    throw new ForbiddenError('ACCOUNT_INACTIVE', 'Tài khoản đã bị vô hiệu hóa');
  }
}
