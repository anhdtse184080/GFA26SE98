import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import {
  BusinessRuleError,
  ConflictError,
  type DomainError,
  ForbiddenError,
  UnauthorizedError,
} from '../../../common/errors/index.js';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { DesignerProfile } from './designer-profile.entity.js';
import { Role } from './role.entity.js';
import { SupplierProfile } from './supplier-profile.entity.js';

export const USER_STATUSES = [
  'INVITED',
  'ACTIVE',
  'INACTIVE',
  'LOCKED',
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Chuyển trạng thái hợp lệ (DB_CONTEXT §6.1):
 * INVITED → ACTIVE chỉ khi xác thực OTP; Admin khóa/mở khóa/vô hiệu hóa tài khoản đã kích hoạt. Không xóa cứng.
 */
const USER_STATUS_TRANSITIONS: Readonly<
  Record<UserStatus, readonly UserStatus[]>
> = {
  INVITED: ['ACTIVE'],
  ACTIVE: ['LOCKED', 'INACTIVE'],
  LOCKED: ['ACTIVE', 'INACTIVE'],
  INACTIVE: ['ACTIVE', 'LOCKED'],
};

export const USER_STATUS_ACTIONS = [
  'LOCK',
  'UNLOCK',
  'DEACTIVATE',
  'REACTIVATE',
] as const;

export type UserStatusAction = (typeof USER_STATUS_ACTIONS)[number];

/**
 * Hành động Admin đổi trạng thái: trạng thái nguồn được phép → trạng thái đích.
 * User INVITED không có hành động nào (mở khóa không được bỏ qua bước xác thực email).
 */
export const USER_STATUS_ACTION_RULES: Readonly<
  Record<UserStatusAction, { from: readonly UserStatus[]; to: UserStatus }>
> = {
  LOCK: { from: ['ACTIVE', 'INACTIVE'], to: 'LOCKED' },
  UNLOCK: { from: ['LOCKED'], to: 'ACTIVE' },
  DEACTIVATE: { from: ['ACTIVE', 'LOCKED'], to: 'INACTIVE' },
  REACTIVATE: { from: ['INACTIVE'], to: 'ACTIVE' },
};

/**
 * Cách một tài khoản INVITED trở thành ACTIVE:
 * - `SELF_REGISTRATION`: customer tự đăng ký (đã có mật khẩu) → `/auth/verify-email`
 * - `INVITATION`: Admin tạo (chưa có mật khẩu) → `/auth/accept-invite`
 */
export type ActivationMethod = 'SELF_REGISTRATION' | 'INVITATION';

type BlockedStatus = Exclude<UserStatus, 'ACTIVE'>;

/** Lỗi khi user không ACTIVE mà đăng nhập / dùng token. */
const BLOCKED_STATUS_ERRORS: Readonly<
  Record<BlockedStatus, [code: string, message: string]>
> = {
  INVITED: [
    'EMAIL_NOT_VERIFIED',
    'Email chưa được xác thực, vui lòng nhập mã OTP đã gửi qua email (hoặc gọi /auth/resend-otp)',
  ],
  LOCKED: ['ACCOUNT_LOCKED', 'Tài khoản đã bị khóa'],
  INACTIVE: ['ACCOUNT_INACTIVE', 'Tài khoản đã bị vô hiệu hóa'],
};

/** Email luôn lưu chữ thường (CHECK) để UQ không phân biệt hoa thường. */
@Entity({ name: 'users' })
@Unique('uq_users_email', ['email'])
@Index('idx_users_role_id', ['roleId'])
@Check('chk_users_status', sqlIn('status', USER_STATUSES))
@Check('chk_users_email_lowercase', `"email" = lower("email")`)
export class User {
  @PrimaryGeneratedColumn('uuid', {
    name: 'id',
    primaryKeyConstraintName: 'pk_users',
  })
  id: string;

  @Column({ name: 'role_id', type: 'smallint' })
  roleId: number;

  @ManyToOne(() => Role, { nullable: false })
  @JoinColumn({ name: 'role_id', foreignKeyConstraintName: 'fk_users_role_id' })
  role?: Relation<Role>;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  email: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash: string | null;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @Column({ name: 'phone', type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: UserStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_users_created_by',
  })
  createdBy?: Relation<User> | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /** Phiên đăng nhập hiện tại (mỗi user tối đa 1 phiên); claim `sid` của access/refresh token. */
  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  /** SHA-256 (hex) của refresh token mới nhất của phiên; xoay mỗi lần refresh. */
  @Column({
    name: 'refresh_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  refreshTokenHash: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Chỉ được nạp khi repository yêu cầu (`findByIdWithProfiles`). */
  @OneToOne(() => DesignerProfile, (profile) => profile.user)
  designerProfile?: Relation<DesignerProfile> | null;

  @OneToOne(() => SupplierProfile, (profile) => profile.user)
  supplierProfile?: Relation<SupplierProfile> | null;

  /** INVITED → ACTIVE khi xác thực OTP. */
  activate(at: Date): void {
    this.transitionTo('ACTIVE');
    this.activatedAt = at;
  }

  /** Người được Admin mời tự đặt mật khẩu: INVITED → ACTIVE. Điều kiện (chưa có mật khẩu) do policy kiểm tra. */
  acceptInvitation(passwordHash: string, at: Date): void {
    this.activate(at);
    this.passwordHash = passwordHash;
  }

  recordLogin(at: Date): void {
    this.lastLoginAt = at;
  }

  /** Mở phiên mới, thay phiên cũ (nếu có): token của phiên cũ hết hiệu lực. */
  startSession(sessionId: string, refreshTokenHash: string): void {
    this.sessionId = sessionId;
    this.refreshTokenHash = refreshTokenHash;
  }

  /** Đăng xuất / thu hồi phiên: mọi access và refresh token đang có hết hiệu lực. */
  revokeSession(): void {
    this.sessionId = null;
    this.refreshTokenHash = null;
  }

  /** Đặt lại mật khẩu (hash đã tính sẵn) và thu hồi phiên hiện tại. Điều kiện trạng thái do service kiểm tra. */
  changePassword(passwordHash: string): void {
    this.passwordHash = passwordHash;
    this.revokeSession();
  }

  /** Sửa thông tin liên hệ: `undefined` = giữ nguyên. */
  updateContact(patch: { fullName?: string; phone?: string | null }): void {
    if (patch.fullName !== undefined) this.fullName = patch.fullName;
    if (patch.phone !== undefined) this.phone = patch.phone;
  }

  /** Admin khóa / mở khóa / vô hiệu hóa / kích hoạt lại theo `USER_STATUS_ACTION_RULES`. */
  applyStatusAction(action: UserStatusAction): void {
    const rule = USER_STATUS_ACTION_RULES[action];
    if (!rule.from.includes(this.status)) {
      throw new BusinessRuleError(
        'INVALID_USER_STATUS_TRANSITION',
        `Không thể ${action} tài khoản đang ở trạng thái ${this.status}`,
        { action, from: this.status, allowedFrom: rule.from },
      );
    }
    this.transitionTo(rule.to);
    // Mở khóa / kích hoạt lại không được làm sống lại refresh token cũ.
    if (rule.to !== 'ACTIVE') this.revokeSession();
  }

  /** Tài khoản còn chờ kích hoạt theo cách nào; `null` nếu không còn INVITED. */
  activationMethod(): ActivationMethod | null {
    if (this.status !== 'INVITED') return null;
    return this.passwordHash === null ? 'INVITATION' : 'SELF_REGISTRATION';
  }

  /**
   * `/auth/verify-email` chỉ dành cho customer tự đăng ký.
   *
   * @throws ConflictError `EMAIL_ALREADY_VERIFIED`
   * @throws ForbiddenError `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   * @throws BusinessRuleError `ACCEPT_INVITE_REQUIRED`
   */
  assertCanVerifyEmail(): void {
    if (this.status === 'ACTIVE') {
      throw new ConflictError(
        'EMAIL_ALREADY_VERIFIED',
        'Email đã được xác thực, vui lòng đăng nhập',
      );
    }
    this.assertNotBlocked();
    if (this.activationMethod() === 'INVITATION') {
      throw new BusinessRuleError(
        'ACCEPT_INVITE_REQUIRED',
        'Tài khoản được mời, vui lòng kích hoạt qua /auth/accept-invite',
        { acceptInviteEndpoint: '/auth/accept-invite' },
      );
    }
  }

  /**
   * `/auth/accept-invite` chỉ dành cho tài khoản Admin tạo, còn INVITED và chưa có mật khẩu.
   *
   * @throws ConflictError `INVITATION_ALREADY_ACCEPTED`
   * @throws ForbiddenError `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   * @throws BusinessRuleError `VERIFY_EMAIL_REQUIRED`
   */
  assertCanAcceptInvite(): void {
    if (this.status === 'ACTIVE') {
      throw new ConflictError(
        'INVITATION_ALREADY_ACCEPTED',
        'Tài khoản đã được kích hoạt, vui lòng đăng nhập',
      );
    }
    this.assertNotBlocked();
    if (this.activationMethod() === 'SELF_REGISTRATION') {
      throw new BusinessRuleError(
        'VERIFY_EMAIL_REQUIRED',
        'Tài khoản tự đăng ký, vui lòng xác thực qua /auth/verify-email',
        { verifyEmailEndpoint: '/auth/verify-email' },
      );
    }
  }

  /** Đăng nhập đúng mật khẩu nhưng trạng thái không cho phép → 403. */
  assertCanLogin(): void {
    const error = this.blockedStatusError(ForbiddenError);
    if (error) throw error;
  }

  /** Token hợp lệ nhưng user không còn ACTIVE (bị khóa sau khi đăng nhập…) → 401. */
  assertCanUseToken(): void {
    const error = this.blockedStatusError(UnauthorizedError);
    if (error) throw error;
  }

  private blockedStatusError(
    ErrorClass: new (code: string, message: string) => DomainError,
  ): DomainError | null {
    if (this.status === 'ACTIVE') return null;
    const [code, message] = BLOCKED_STATUS_ERRORS[this.status];
    return new ErrorClass(code, message);
  }

  /** LOCKED / INACTIVE không được kích hoạt bằng OTP. */
  private assertNotBlocked(): void {
    if (this.status === 'LOCKED') {
      throw new ForbiddenError('ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
    }
    if (this.status === 'INACTIVE') {
      throw new ForbiddenError(
        'ACCOUNT_INACTIVE',
        'Tài khoản đã bị vô hiệu hóa',
      );
    }
  }

  private transitionTo(to: UserStatus): void {
    if (!USER_STATUS_TRANSITIONS[this.status].includes(to)) {
      throw new BusinessRuleError(
        'INVALID_USER_STATUS_TRANSITION',
        `Không thể chuyển trạng thái tài khoản từ ${this.status} sang ${to}`,
        { from: this.status, to },
      );
    }
    this.status = to;
  }
}
