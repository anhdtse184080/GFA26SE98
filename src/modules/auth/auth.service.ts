import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, JwtPayload } from '../../common/auth/auth-user.js';
import { roleCodeOf } from '../../common/auth/role-code.js';
import {
  BusinessRuleError,
  ConflictError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../common/errors/index.js';
import { accountActivationEmail } from '../../common/mail-templates/account-activation.template.js';
import { passwordResetEmail } from '../../common/mail-templates/password-reset.template.js';
import { MAILER, type Mailer } from '../../common/ports/mailer.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../common/ports/password-hasher.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { OtpService } from '../otp/otp.service.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';

export interface RegisterInput {
  /** Đã chuẩn hóa (trim + lowercase) ở DTO. */
  email: string;
  fullName: string;
  phone: string | null;
  password: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/** Payload của refresh token (kèm `jti` ngẫu nhiên để mỗi token là duy nhất). */
interface RefreshTokenPayload {
  sub: string;
  sid: string;
}

const PASSWORD_FINGERPRINT_LENGTH = 16;

/**
 * Xác thực và phiên đăng nhập:
 * - Đăng ký customer, xác thực email, nhận lời mời (Staff/Designer/Supplier), gửi lại OTP.
 * - Đăng nhập, refresh, đăng xuất, xác thực access token ở mỗi request. Mỗi user tối đa 1 phiên
 *   (`users.session_id`), access token ngắn hạn + refresh token xoay vòng (`users.refresh_token_hash`).
 * - Quên / đặt lại / đổi mật khẩu.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash giả để so mật khẩu khi email không tồn tại: thời gian phản hồi không lộ email có hay không. */
  private dummyHash?: Promise<string>;
  /** Khóa HMAC cho claim `pwv` (dấu vân tay `password_hash`). */
  private readonly fingerprintKey: Buffer;
  /** Khóa ký refresh token, khác khóa access token: không dùng lẫn được hai loại token. */
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(MAILER) private readonly mailer: Mailer,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    // Các khóa dẫn xuất từ JWT_SECRET bằng HMAC tách miền (khác nhau theo mục đích).
    const secret = config.get('JWT_SECRET', { infer: true });
    this.fingerprintKey = createHmac('sha256', secret)
      .update('password-fingerprint')
      .digest();
    this.refreshSecret = createHmac('sha256', secret)
      .update('refresh-token')
      .digest('hex');
    this.refreshExpiresIn = config.get('REFRESH_TOKEN_EXPIRES_IN', {
      infer: true,
    });
  }

  // ---------- Đăng ký & kích hoạt ----------

  /**
   * Customer tự đăng ký → INVITED; commit xong mới phát OTP và gửi email.
   * Gửi email lỗi không làm hỏng đăng ký (user gọi resend-otp).
   *
   * @throws ConflictError `EMAIL_ALREADY_EXISTS` | `EMAIL_NOT_VERIFIED`
   */
  async register(input: RegisterInput): Promise<User> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw existing.activationMethod() === 'SELF_REGISTRATION'
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
    user.assertCanVerifyEmail();

    // Verify ngoài transaction (xem OtpService.verify).
    await this.otp.verify(user.id, 'ACCOUNT_ACTIVATION', code);
    return this.users.activate(user);
  }

  /**
   * Người được Admin mời nhập OTP trong email lời mời và tự đặt mật khẩu → ACTIVE.
   * Không tự đăng nhập: client gọi `/auth/login` sau đó.
   *
   * @throws BusinessRuleError `OTP_INVALID` (kể cả email không tồn tại) | `OTP_EXPIRED` | `VERIFY_EMAIL_REQUIRED`
   * @throws TooManyRequestsError `OTP_TOO_MANY_ATTEMPTS`
   * @throws ConflictError `INVITATION_ALREADY_ACCEPTED`
   * @throws ForbiddenError `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   */
  async acceptInvite(
    email: string,
    code: string,
    password: string,
  ): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (!user)
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không hợp lệ');
    user.assertCanAcceptInvite();

    // Verify ngoài transaction (xem OtpService.verify).
    await this.otp.verify(user.id, 'ACCOUNT_ACTIVATION', code);
    const passwordHash = await this.hasher.hash(password);
    return this.users.acceptInvitation(user, passwordHash);
  }

  /**
   * Gửi lại mã cho tài khoản còn INVITED: customer tự đăng ký nhận OTP kích hoạt,
   * tài khoản do Admin tạo nhận lại email lời mời (thời hạn lời mời). Các trường hợp khác
   * (email không tồn tại, đã ACTIVE/LOCKED/INACTIVE) bỏ qua im lặng để không lộ email.
   *
   * @throws TooManyRequestsError `OTP_RESEND_TOO_SOON`
   */
  async resendActivationOtp(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    const method = user?.activationMethod() ?? null;
    if (!user || method === null) return;

    if (method === 'INVITATION') {
      await this.users.resendInvite(user.id);
      return;
    }
    await this.otp.assertCanResend(user.id, 'ACCOUNT_ACTIVATION');
    await this.deliverActivationOtp(user);
  }

  // ---------- Đăng nhập & phiên ----------

  /**
   * Gọi từ LocalStrategy: kiểm tra email + mật khẩu và trạng thái tài khoản.
   *
   * @throws UnauthorizedError `INVALID_CREDENTIALS` – sai email hoặc mật khẩu (không phân biệt)
   * @throws ForbiddenError `EMAIL_NOT_VERIFIED` | `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE`
   */
  async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const matches = await this.hasher.compare(password, hash);
    if (!user || user.passwordHash === null || !matches) {
      throw new UnauthorizedError(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không đúng',
      );
    }
    user.assertCanLogin();
    return user;
  }

  /** Mở phiên mới cho user đã qua `validateCredentials` (phiên cũ trên thiết bị khác hết hiệu lực). */
  async login(user: User): Promise<SessionTokens> {
    return this.startSession(await this.users.recordLogin(user));
  }

  /**
   * Đổi refresh token lấy cặp token mới (refresh token cũ bị vô hiệu). Refresh token cũ
   * của phiên bị dùng lại → coi như bị đánh cắp: thu hồi cả phiên.
   *
   * @throws UnauthorizedError `INVALID_REFRESH_TOKEN` | `TOKEN_REVOKED` | `REFRESH_TOKEN_REUSED` | `ACCOUNT_LOCKED` | `ACCOUNT_INACTIVE` | `EMAIL_NOT_VERIFIED`
   */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedError(
        'INVALID_REFRESH_TOKEN',
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }
    const user = await this.users.findById(payload.sub);
    if (!user || user.sessionId === null || user.sessionId !== payload.sid) {
      throw this.revokedError();
    }
    user.assertCanUseToken();

    const nextToken = await this.signRefreshToken(payload);
    const rotated = await this.users.rotateRefreshToken(
      user.id,
      payload.sid,
      this.hashRefreshToken(refreshToken),
      this.hashRefreshToken(nextToken),
    );
    if (!rotated) {
      await this.users.revokeSession(user);
      throw new UnauthorizedError(
        'REFRESH_TOKEN_REUSED',
        'Refresh token đã được sử dụng, phiên đăng nhập bị thu hồi, vui lòng đăng nhập lại',
      );
    }
    return {
      accessToken: await this.issueAccessToken(user),
      refreshToken: nextToken,
      user,
    };
  }

  /** Thu hồi phiên của refresh token. Token không hợp lệ / phiên đã đổi → bỏ qua (idempotent). */
  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload) return;
    const user = await this.users.findById(payload.sub);
    if (user && user.sessionId === payload.sid) {
      await this.users.revokeSession(user);
    }
  }

  /**
   * Gọi từ JwtStrategy cho mỗi request: kiểm tra lại user trong DB, nên token của user đã bị
   * khóa, đổi role, đổi mật khẩu (`pwv`) hoặc đã logout / đăng nhập nơi khác (`sid`) bị từ chối.
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
    user.assertCanUseToken();
    if (
      user.passwordHash === null ||
      !this.fingerprintMatches(user.passwordHash, payload.pwv) ||
      user.sessionId === null ||
      user.sessionId !== payload.sid
    ) {
      throw this.revokedError();
    }
    return { id: user.id, email: user.email, role: payload.role };
  }

  // ---------- Mật khẩu ----------

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
        expiresInMinutes: this.otp.ttlMinutes,
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
   * Xác thực OTP `PASSWORD_RESET` rồi đổi mật khẩu. Đổi xong, phiên hiện tại bị thu hồi:
   * mọi access/refresh token cũ bị từ chối.
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

  /**
   * User đã đăng nhập tự đổi mật khẩu rồi mở phiên mới: mọi token cũ (kể cả token đang dùng)
   * bị thu hồi (`pwv` không còn khớp `password_hash`, phiên cũ bị thay).
   *
   * @throws UnauthorizedError `INVALID_CURRENT_PASSWORD`
   * @throws BusinessRuleError `NEW_PASSWORD_SAME_AS_CURRENT`
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<SessionTokens> {
    const user = await this.users.findById(userId);
    const hash = user?.passwordHash;
    if (!user || !hash || !(await this.hasher.compare(currentPassword, hash))) {
      throw new UnauthorizedError(
        'INVALID_CURRENT_PASSWORD',
        'Mật khẩu hiện tại không đúng',
      );
    }
    if (await this.hasher.compare(newPassword, hash)) {
      throw new BusinessRuleError(
        'NEW_PASSWORD_SAME_AS_CURRENT',
        'Mật khẩu mới phải khác mật khẩu hiện tại',
      );
    }

    const updated = await this.users.changePassword(
      user,
      await this.hasher.hash(newPassword),
    );
    return this.startSession(updated);
  }

  // ---------- Private: token ----------

  /** Mở phiên mới cho user đã xác thực mật khẩu; phiên cũ (thiết bị khác) hết hiệu lực. */
  private async startSession(user: User): Promise<SessionTokens> {
    const sessionId = randomUUID();
    const refreshToken = await this.signRefreshToken({
      sub: user.id,
      sid: sessionId,
    });
    const updated = await this.users.startSession(
      user,
      sessionId,
      this.hashRefreshToken(refreshToken),
    );
    return {
      accessToken: await this.issueAccessToken(updated),
      refreshToken,
      user: updated,
    };
  }

  /**
   * Access token: claim `pwv` gắn token với `password_hash`, `sid` gắn với phiên hiện tại.
   * `user` phải đã có mật khẩu và phiên; thiếu là lỗi lập trình.
   */
  private issueAccessToken(user: User): Promise<string> {
    if (user.passwordHash === null || user.sessionId === null) {
      throw new Error(
        `User ${user.id} chưa có mật khẩu hoặc phiên, không phát token`,
      );
    }
    const payload: JwtPayload = {
      sub: user.id,
      role: roleCodeOf(user.roleId),
      pwv: this.passwordFingerprint(user.passwordHash),
      sid: user.sessionId,
    };
    return this.jwt.signAsync(payload);
  }

  private signRefreshToken({ sub, sid }: RefreshTokenPayload): Promise<string> {
    return this.jwt.signAsync(
      { sub, sid },
      {
        secret: this.refreshSecret,
        algorithm: 'HS256',
        expiresIn: this.refreshExpiresIn as `${number}d`,
        jwtid: randomUUID(),
      },
    );
  }

  /** Sai chữ ký, hết hạn, thiếu claim → `null`. */
  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload | null> {
    try {
      const payload: unknown = await this.jwt.verifyAsync(token, {
        secret: this.refreshSecret,
        algorithms: ['HS256'],
      });
      if (typeof payload !== 'object' || payload === null) return null;
      const { sub, sid } = payload as Record<string, unknown>;
      return typeof sub === 'string' && typeof sid === 'string'
        ? { sub, sid }
        : null;
    } catch {
      return null;
    }
  }

  /** Giá trị lưu ở `users.refresh_token_hash`. Token đủ ngẫu nhiên (có `jti`) nên SHA-256 không cần khóa. */
  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Claim `pwv`: HMAC của `password_hash` hiện tại. Đổi mật khẩu → hash mới
   * → mọi token phát hành trước đó không còn khớp. Có khóa nên không lộ hash mật khẩu.
   */
  private passwordFingerprint(passwordHash: string): string {
    return createHmac('sha256', this.fingerprintKey)
      .update(passwordHash)
      .digest('base64url')
      .slice(0, PASSWORD_FINGERPRINT_LENGTH);
  }

  /** So sánh thời gian hằng; `pwv` thiếu hoặc sai kiểu → false. */
  private fingerprintMatches(passwordHash: string, pwv: unknown): boolean {
    if (typeof pwv !== 'string') return false;
    const expected = Buffer.from(this.passwordFingerprint(passwordHash));
    const actual = Buffer.from(pwv);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private revokedError(): UnauthorizedError {
    return new UnauthorizedError(
      'TOKEN_REVOKED',
      'Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại',
    );
  }

  // ---------- Private: khác ----------

  /** Phát OTP (transaction riêng, đã commit) rồi mới gửi email. */
  private async deliverActivationOtp(user: User): Promise<void> {
    const code = await this.otp.issue(user.id, 'ACCOUNT_ACTIVATION');
    const mail = accountActivationEmail({
      fullName: user.fullName,
      otp: code,
      expiresInMinutes: this.otp.ttlMinutes,
    });
    await this.mailer.send({ to: user.email, ...mail });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('dummy-password-for-timing-1');
    return this.dummyHash;
  }
}
