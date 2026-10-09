import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, JwtPayload } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../common/errors/index.js';
import { MAILER, type Mailer } from '../../common/ports/mailer.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../common/ports/password-hasher.js';
import { accountActivationEmail } from '../../infrastructure/mail/templates/account-activation.template.js';
import { passwordResetEmail } from '../../infrastructure/mail/templates/password-reset.template.js';
import type { User } from '../users/entities/user.entity.js';
import { roleCodeOf } from '../users/role-code.enum.js';
import { UsersService } from '../users/users.service.js';
import { AuthPolicy } from './auth.policy.js';
import { OTP_CONFIG, type OtpConfig } from './otp.config.js';
import { OtpService } from './otp.service.js';
import {
  PASSWORD_FINGERPRINT_KEY,
  passwordFingerprint,
  passwordFingerprintMatches,
} from './password-fingerprint.js';

export interface RegisterInput {
  /** Đã chuẩn hóa (trim + lowercase) ở DTO. */
  email: string;
  fullName: string;
  phone: string | null;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  user: User;
}

/**
 * Đăng ký customer, xác thực email, đăng nhập, quên/đặt lại mật khẩu, xác thực access token.
 * Chấp nhận lời mời (Staff/Designer/Supplier) làm riêng.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash giả để so mật khẩu khi email không tồn tại: thời gian phản hồi không lộ email có hay không. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(OTP_CONFIG) private readonly otpConfig: OtpConfig,
    private readonly jwt: JwtService,
    @Inject(PASSWORD_FINGERPRINT_KEY) private readonly fingerprintKey: Buffer,
  ) {}

  /**
   * Customer tự đăng ký → INVITED; commit xong mới phát OTP và gửi email.
   * Gửi email lỗi không làm hỏng đăng ký (user gọi resend-otp).
   *
   * @throws ConflictError `EMAIL_ALREADY_EXISTS` | `EMAIL_NOT_VERIFIED`
   */
  async register(input: RegisterInput): Promise<User> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw existing.status === 'INVITED' && existing.passwordHash !== null
        ? new ConflictError(
            'EMAIL_NOT_VERIFIED',
            'Email đã đăng ký nhưng chưa xác thực, vui lòng gọi /auth/resend-otp để nhận mã mới',
            { resendEndpoint: '/auth/resend-otp' },
          )
        : new ConflictError('EMAIL_ALREADY_EXISTS', 'Email đã được sử dụng');
    }

    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.users.registerCustomer({
      email: input.email,
      fullName: input.fullName,
      phone: input.phone,
      passwordHash,
    });

    try {
      await this.deliverActivationOtp(user);
    } catch (error) {
      this.logger.error(
        `Không gửi được OTP kích hoạt cho user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return user;
  }

  /**
   * Customer tự đăng ký nhập OTP → ACTIVE.
   *
   * @throws BusinessRuleError `OTP_INVALID` | `OTP_EXPIRED` | `ACCEPT_INVITE_REQUIRED`
   * @throws TooManyRequestsError `OTP_TOO_MANY_ATTEMPTS`
   * @throws ConflictError `EMAIL_ALREADY_VERIFIED`
   * @throws ForbiddenError `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   */
  async verifyEmail(email: string, code: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    // Không tiết lộ email có tồn tại hay không.
    if (!user)
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không hợp lệ');
    if (user.status === 'ACTIVE') {
      throw new ConflictError(
        'EMAIL_ALREADY_VERIFIED',
        'Email đã được xác thực, vui lòng đăng nhập',
      );
    }
    if (user.status !== 'INVITED') AuthPolicy.assertCanLogin(user.status);
    if (user.passwordHash === null) {
      throw new BusinessRuleError(
        'ACCEPT_INVITE_REQUIRED',
        'Tài khoản được mời, vui lòng kích hoạt qua /auth/accept-invite',
      );
    }

    // Verify ngoài transaction (xem OtpService.verify).
    await this.otp.verify(user.id, 'ACCOUNT_ACTIVATION', code);
    return this.users.activate(user);
  }

  /**
   * Gửi lại OTP kích hoạt cho customer tự đăng ký còn INVITED. Các trường hợp khác
   * (email không tồn tại, đã ACTIVE, tài khoản được mời) bỏ qua im lặng để không lộ email.
   *
   * @throws TooManyRequestsError `OTP_RESEND_TOO_SOON`
   */
  async resendActivationOtp(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'INVITED' || user.passwordHash === null) {
      return;
    }
    await this.otp.assertCanResend(user.id, 'ACCOUNT_ACTIVATION');
    await this.deliverActivationOtp(user);
  }

  /**
   * @throws UnauthorizedError `INVALID_CREDENTIALS` – sai email hoặc mật khẩu (không phân biệt)
   * @throws ForbiddenError `EMAIL_NOT_VERIFIED` | `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const matches = await this.hasher.compare(password, hash);
    if (!user || user.passwordHash === null || !matches) {
      throw new UnauthorizedError(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không đúng',
      );
    }
    AuthPolicy.assertCanLogin(user.status);

    const updated = await this.users.recordLogin(user);
    const payload: JwtPayload = {
      sub: updated.id,
      role: roleCodeOf(updated.roleId),
      pwv: passwordFingerprint(this.fingerprintKey, user.passwordHash),
    };
    return { accessToken: await this.jwt.signAsync(payload), user: updated };
  }

  /**
   * Gửi OTP đặt lại mật khẩu cho user ACTIVE. Mọi trường hợp khác (email không tồn tại,
   * chưa ACTIVE, đang trong cooldown, gửi mail lỗi) bỏ qua im lặng: response luôn giống nhau
   * để không lộ email nào đang có tài khoản hoạt động.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'ACTIVE' || user.passwordHash === null) {
      return;
    }
    try {
      await this.otp.assertCanResend(user.id, 'PASSWORD_RESET');
    } catch (error) {
      if (error instanceof TooManyRequestsError) return;
      throw error;
    }

    try {
      const code = await this.otp.issue(user.id, 'PASSWORD_RESET');
      const mail = passwordResetEmail({
        fullName: user.fullName,
        otp: code,
        expiresInMinutes: this.otpConfig.ttlMinutes,
      });
      await this.mailer.send({ to: user.email, ...mail });
    } catch (error) {
      this.logger.error(
        `Không gửi được OTP đặt lại mật khẩu cho user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Xác thực OTP `PASSWORD_RESET` rồi đổi mật khẩu. Đổi xong, mọi access token cũ
   * bị từ chối (claim `pwv` không còn khớp `password_hash`).
   *
   * @throws BusinessRuleError `OTP_INVALID` (kể cả email không tồn tại / user không ACTIVE) | `OTP_EXPIRED`
   * @throws TooManyRequestsError `OTP_TOO_MANY_ATTEMPTS`
   */
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'ACTIVE' || user.passwordHash === null) {
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không hợp lệ');
    }

    // Verify ngoài transaction (xem OtpService.verify).
    await this.otp.verify(user.id, 'PASSWORD_RESET', code);
    await this.users.changePassword(user, await this.hasher.hash(newPassword));
  }

  /** User hiện tại kèm profile designer/supplier. */
  me(userId: string): Promise<User> {
    return this.users.getWithProfiles(userId);
  }

  /**
   * Gọi từ JwtStrategy cho mỗi request: kiểm tra lại user trong DB, nên token cũ
   * của user đã bị khóa/vô hiệu hóa hoặc đổi role bị từ chối.
   *
   * @throws UnauthorizedError `INVALID_TOKEN` | `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE` | `EMAIL_NOT_VERIFIED` | `TOKEN_REVOKED`
   */
  async authenticate(payload: JwtPayload): Promise<AuthUser> {
    const user =
      typeof payload.sub === 'string'
        ? await this.users.findById(payload.sub)
        : null;
    if (!user || roleCodeOf(user.roleId) !== payload.role) {
      throw new UnauthorizedError('INVALID_TOKEN', 'Access token không hợp lệ');
    }
    AuthPolicy.assertCanUseToken(user.status);
    if (
      user.passwordHash === null ||
      !passwordFingerprintMatches(
        this.fingerprintKey,
        user.passwordHash,
        payload.pwv,
      )
    ) {
      throw new UnauthorizedError(
        'TOKEN_REVOKED',
        'Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại',
      );
    }
    return { id: user.id, email: user.email, role: payload.role };
  }

  /** Phát OTP (transaction riêng, đã commit) rồi mới gửi email. */
  private async deliverActivationOtp(user: User): Promise<void> {
    const code = await this.otp.issue(user.id, 'ACCOUNT_ACTIVATION');
    const mail = accountActivationEmail({
      fullName: user.fullName,
      otp: code,
      expiresInMinutes: this.otpConfig.ttlMinutes,
    });
    await this.mailer.send({ to: user.email, ...mail });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('dummy-password-for-timing-1');
    return this.dummyHash;
  }
}
