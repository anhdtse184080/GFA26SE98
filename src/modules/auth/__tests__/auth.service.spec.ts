import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../../common/errors/index.js';
import type { PasswordHasher } from '../../../common/ports/password-hasher.js';
import type { UnitOfWork } from '../../../database/unit-of-work.js';
import { FakeClock } from '../../../../test/support/fake-clock.js';
import {
  extractOtp,
  FakeMailer,
} from '../../../../test/support/fake-mailer.js';
import { InMemoryUserRepository } from '../../users/__tests__/in-memory-user.repository.js';
import type { DesignerProfile } from '../../users/entities/designer-profile.entity.js';
import type { User } from '../../users/entities/user.entity.js';
import type { RoleCode } from '../../users/role-code.enum.js';
import { ROLE_IDS } from '../../users/role-code.enum.js';
import type { UserStatus } from '../../users/user-status.js';
import { UsersService } from '../../users/users.service.js';
import { AuthService } from '../auth.service.js';
import { deriveOtpHashKey } from '../otp-code.js';
import type { OtpConfig } from '../otp.config.js';
import { OtpService } from '../otp.service.js';
import {
  derivePasswordFingerprintKey,
  passwordFingerprint,
} from '../password-fingerprint.js';
import { InMemoryOtpRepository } from './in-memory-otp.repository.js';

const SECOND = 1_000;
const T0 = new Date('2026-10-09T08:00:00.000Z');
const SECRET = 'j'.repeat(32);
const EMAIL = 'khach@example.com';
const PASSWORD = 'matkhau123';

/** Hasher giả, nhanh và tất định: `hash(x) = "hashed:" + x`. */
class FakePasswordHasher implements PasswordHasher {
  hash(plain: string) {
    return Promise.resolve(`hashed:${plain}`);
  }
  compare(plain: string, hash: string) {
    return Promise.resolve(hash === `hashed:${plain}`);
  }
}

const fakeUow = {
  run: <T>(fn: () => Promise<T>) => fn(),
} as unknown as UnitOfWork;

function setup() {
  const clock = new FakeClock(T0);
  const userRepo = new InMemoryUserRepository(() => clock.now());
  const otpRepo = new InMemoryOtpRepository();
  const mailer = new FakeMailer();
  const hasher = new FakePasswordHasher();
  const otpConfig: OtpConfig = {
    ttlMinutes: 15,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
    hashKey: deriveOtpHashKey(SECRET),
  };
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const users = new UsersService(userRepo, clock);
  const otp = new OtpService(otpRepo, clock, otpConfig, fakeUow);
  const fingerprintKey = derivePasswordFingerprintKey(SECRET);
  const service = new AuthService(
    users,
    otp,
    hasher,
    mailer,
    otpConfig,
    jwt,
    fingerprintKey,
  );

  /** Payload hợp lệ cho user theo `password_hash` hiện tại. */
  function payloadFor(user: User, role: RoleCode = 'CUSTOMER'): JwtPayload {
    return {
      sub: user.id,
      role,
      pwv: passwordFingerprint(fingerprintKey, user.passwordHash ?? ''),
    };
  }

  /** User đã có sẵn trong "DB". */
  function seedUser(
    status: UserStatus,
    overrides: {
      email?: string;
      roleId?: number;
      passwordHash?: string | null;
    } = {},
  ) {
    return userRepo.seed({
      roleId: overrides.roleId ?? ROLE_IDS.CUSTOMER,
      email: overrides.email ?? EMAIL,
      passwordHash:
        overrides.passwordHash === undefined
          ? `hashed:${PASSWORD}`
          : overrides.passwordHash,
      fullName: 'Nguyễn Văn A',
      phone: null,
      status,
      createdById: null,
      activatedAt: status === 'ACTIVE' ? T0 : null,
    });
  }

  const register = (email = EMAIL) =>
    service.register({
      email,
      fullName: 'Nguyễn Văn A',
      phone: '0901234567',
      password: PASSWORD,
    });

  return {
    clock,
    userRepo,
    otpRepo,
    mailer,
    jwt,
    otp,
    service,
    seedUser,
    register,
    payloadFor,
  };
}

describe('AuthService', () => {
  describe('register', () => {
    it('tạo CUSTOMER INVITED, created_by null, lưu hash mật khẩu, gửi email OTP kích hoạt', async () => {
      const { userRepo, otpRepo, mailer, register } = setup();

      const user = await register();

      expect(user).toMatchObject({
        roleId: ROLE_IDS.CUSTOMER,
        email: EMAIL,
        status: 'INVITED',
        createdById: null,
        passwordHash: `hashed:${PASSWORD}`,
        phone: '0901234567',
        activatedAt: null,
      });
      expect(userRepo.rows).toHaveLength(1);
      expect(otpRepo.rows).toHaveLength(1);
      expect(otpRepo.rows[0]).toMatchObject({
        userId: user.id,
        purpose: 'ACCOUNT_ACTIVATION',
      });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0].to).toBe(EMAIL);
      expect(extractOtp(mailer.sent[0])).toMatch(/^\d{6}$/);
    });

    it('email đã ACTIVE → EMAIL_ALREADY_EXISTS (409), không tạo user, không gửi email', async () => {
      const { userRepo, mailer, seedUser, register } = setup();
      seedUser('ACTIVE');

      const error = await register().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
      expect(userRepo.rows).toHaveLength(1);
      expect(mailer.sent).toHaveLength(0);
    });

    it('email còn INVITED (tự đăng ký) → EMAIL_NOT_VERIFIED kèm gợi ý resend', async () => {
      const { seedUser, register } = setup();
      seedUser('INVITED');

      const error = await register().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
        details: { resendEndpoint: '/auth/resend-otp' },
      });
    });

    it.each(['LOCKED', 'INACTIVE'] as const)(
      'email %s → EMAIL_ALREADY_EXISTS',
      async (status) => {
        const { seedUser, register } = setup();
        seedUser(status);

        await expect(register()).rejects.toMatchObject({
          code: 'EMAIL_ALREADY_EXISTS',
        });
      },
    );

    it('email của tài khoản do Admin mời (INVITED, chưa có mật khẩu) → EMAIL_ALREADY_EXISTS', async () => {
      const { seedUser, register } = setup();
      seedUser('INVITED', { roleId: ROLE_IDS.STAFF, passwordHash: null });

      await expect(register()).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_EXISTS',
      });
    });

    it('email bị chiếm giữa lúc kiểm tra và lúc insert → EMAIL_ALREADY_EXISTS', async () => {
      const { userRepo, register } = setup();
      vi.spyOn(userRepo, 'createIfEmailAvailable').mockResolvedValueOnce(null);

      await expect(register()).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_EXISTS',
      });
    });

    it('gửi email lỗi vẫn đăng ký thành công (user gọi resend-otp sau)', async () => {
      const { userRepo, mailer, register } = setup();
      vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('SMTP down'));

      const user = await register();

      expect(user.status).toBe('INVITED');
      expect(userRepo.rows).toHaveLength(1);
    });
  });

  describe('verifyEmail', () => {
    it('OTP đúng → ACTIVE, activated_at = now', async () => {
      const { clock, userRepo, mailer, service, register } = setup();
      await register();
      clock.advance(30 * SECOND);

      const user = await service.verifyEmail(
        EMAIL,
        extractOtp(mailer.lastTo(EMAIL))!,
      );

      expect(user.status).toBe('ACTIVE');
      expect(user.activatedAt).toEqual(clock.now());
      expect(userRepo.rows[0].status).toBe('ACTIVE');
    });

    it('OTP sai → OTP_INVALID, vẫn INVITED', async () => {
      const { userRepo, mailer, service, register } = setup();
      await register();
      const code = extractOtp(mailer.lastTo(EMAIL))!;

      const error = await service
        .verifyEmail(EMAIL, code === '000000' ? '000001' : '000000')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error).toMatchObject({
        code: 'OTP_INVALID',
        details: { remainingAttempts: 4 },
      });
      expect(userRepo.rows[0].status).toBe('INVITED');
    });

    it('email không tồn tại → OTP_INVALID (không lộ email)', async () => {
      const { service } = setup();

      await expect(
        service.verifyEmail('khong-co@example.com', '123456'),
      ).rejects.toMatchObject({
        code: 'OTP_INVALID',
      });
    });

    it('đã ACTIVE → EMAIL_ALREADY_VERIFIED', async () => {
      const { service, seedUser } = setup();
      seedUser('ACTIVE');

      await expect(service.verifyEmail(EMAIL, '123456')).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_VERIFIED',
      });
    });

    it('tài khoản do Admin mời (chưa có mật khẩu) → ACCEPT_INVITE_REQUIRED, không kích hoạt', async () => {
      const { userRepo, service, seedUser } = setup();
      seedUser('INVITED', { roleId: ROLE_IDS.DESIGNER, passwordHash: null });

      await expect(service.verifyEmail(EMAIL, '123456')).rejects.toMatchObject({
        code: 'ACCEPT_INVITE_REQUIRED',
      });
      expect(userRepo.rows[0].status).toBe('INVITED');
    });

    it('tài khoản LOCKED → ACCOUNT_LOCKED (không mở khóa qua OTP)', async () => {
      const { service, seedUser } = setup();
      seedUser('LOCKED');

      const error = await service
        .verifyEmail(EMAIL, '123456')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });
  });

  describe('resendActivationOtp', () => {
    it('INVITED, hết cooldown → OTP mới, OTP cũ không dùng được nữa', async () => {
      const { clock, mailer, service, register } = setup();
      await register();
      const oldCode = extractOtp(mailer.lastTo(EMAIL))!;
      clock.advance(60 * SECOND);

      await service.resendActivationOtp(EMAIL);

      expect(mailer.sent).toHaveLength(2);
      const newCode = extractOtp(mailer.lastTo(EMAIL))!;
      if (oldCode !== newCode) {
        await expect(service.verifyEmail(EMAIL, oldCode)).rejects.toMatchObject(
          {
            code: 'OTP_INVALID',
          },
        );
      }
      await expect(service.verifyEmail(EMAIL, newCode)).resolves.toMatchObject({
        status: 'ACTIVE',
      });
    });

    it('trong cooldown → OTP_RESEND_TOO_SOON, không gửi thêm', async () => {
      const { clock, mailer, service, register } = setup();
      await register();
      clock.advance(10 * SECOND);

      const error = await service
        .resendActivationOtp(EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TooManyRequestsError);
      expect(error).toMatchObject({
        code: 'OTP_RESEND_TOO_SOON',
        details: { retryAfterSeconds: 50 },
      });
      expect(mailer.sent).toHaveLength(1);
    });

    it('email không tồn tại → không lỗi, không gửi gì', async () => {
      const { mailer, service } = setup();

      await expect(
        service.resendActivationOtp('khong-co@example.com'),
      ).resolves.toBeUndefined();
      expect(mailer.sent).toHaveLength(0);
    });

    it.each(['ACTIVE', 'LOCKED', 'INACTIVE'] as const)(
      'user %s → không lỗi, không gửi gì',
      async (status) => {
        const { mailer, service, seedUser } = setup();
        seedUser(status);

        await service.resendActivationOtp(EMAIL);

        expect(mailer.sent).toHaveLength(0);
      },
    );

    it('tài khoản do Admin mời → không gửi email kích hoạt kiểu tự đăng ký', async () => {
      const { mailer, service, seedUser } = setup();
      seedUser('INVITED', { roleId: ROLE_IDS.STAFF, passwordHash: null });

      await service.resendActivationOtp(EMAIL);

      expect(mailer.sent).toHaveLength(0);
    });
  });

  describe('login', () => {
    it('ACTIVE + đúng mật khẩu → accessToken { sub, role }, cập nhật last_login_at', async () => {
      const { clock, userRepo, jwt, service, seedUser } = setup();
      const seeded = seedUser('ACTIVE');
      clock.advance(5 * SECOND);

      const { accessToken, user } = await service.login(EMAIL, PASSWORD);

      expect(user.lastLoginAt).toEqual(clock.now());
      expect(userRepo.rows[0].lastLoginAt).toEqual(clock.now());
      const payload = await jwt.verifyAsync<{
        sub: string;
        role: string;
        exp: number;
        iat: number;
      }>(accessToken);
      expect(payload).toMatchObject({ sub: seeded.id, role: 'CUSTOMER' });
      expect(payload.exp - payload.iat).toBe(3600);
    });

    it('sai mật khẩu → INVALID_CREDENTIALS (401)', async () => {
      const { userRepo, service, seedUser } = setup();
      seedUser('ACTIVE');

      const error = await service
        .login(EMAIL, 'saimatkhau1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(userRepo.rows[0].lastLoginAt).toBeNull();
    });

    it('email không tồn tại → cùng lỗi INVALID_CREDENTIALS', async () => {
      const { service } = setup();

      await expect(
        service.login('khong-co@example.com', PASSWORD),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('tài khoản chưa có mật khẩu (được mời) → INVALID_CREDENTIALS', async () => {
      const { service, seedUser } = setup();
      seedUser('INVITED', { roleId: ROLE_IDS.STAFF, passwordHash: null });

      await expect(service.login(EMAIL, PASSWORD)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it.each([
      ['INVITED', 'EMAIL_NOT_VERIFIED'],
      ['LOCKED', 'ACCOUNT_LOCKED'],
      ['INACTIVE', 'ACCOUNT_INACTIVE'],
    ] as const)('%s + đúng mật khẩu → %s (403)', async (status, code) => {
      const { userRepo, service, seedUser } = setup();
      seedUser(status);

      const error = await service
        .login(EMAIL, PASSWORD)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error).toMatchObject({ code });
      expect(userRepo.rows[0].lastLoginAt).toBeNull();
    });

    it('trạng thái bị chặn nhưng sai mật khẩu → INVALID_CREDENTIALS (không lộ trạng thái)', async () => {
      const { service, seedUser } = setup();
      seedUser('LOCKED');

      await expect(service.login(EMAIL, 'saimatkhau1')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('luồng đầy đủ: đăng ký → bị chặn → xác thực → đăng nhập được', async () => {
      const { mailer, service, register } = setup();
      await register();
      await expect(service.login(EMAIL, PASSWORD)).rejects.toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });

      await service.verifyEmail(EMAIL, extractOtp(mailer.lastTo(EMAIL))!);

      await expect(service.login(EMAIL, PASSWORD)).resolves.toHaveProperty(
        'accessToken',
      );
    });
  });

  describe('authenticate (kiểm tra token mỗi request)', () => {
    it('user ACTIVE, đúng role → AuthUser', async () => {
      const { service, seedUser, payloadFor } = setup();
      const user = seedUser('ACTIVE');

      await expect(service.authenticate(payloadFor(user))).resolves.toEqual({
        id: user.id,
        email: EMAIL,
        role: 'CUSTOMER',
      });
    });

    it.each([
      ['LOCKED', 'ACCOUNT_LOCKED'],
      ['INACTIVE', 'ACCOUNT_INACTIVE'],
    ] as const)(
      'user bị %s sau khi đăng nhập → %s (401)',
      async (status, code) => {
        const { service, seedUser, payloadFor } = setup();
        const user = seedUser(status);

        const error = await service
          .authenticate(payloadFor(user))
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(UnauthorizedError);
        expect(error).toMatchObject({ code });
      },
    );

    it('user không tồn tại → INVALID_TOKEN', async () => {
      const { service } = setup();

      await expect(
        service.authenticate({
          sub: '33333333-3333-4333-8333-333333333333',
          role: 'CUSTOMER',
          pwv: 'khong-quan-trong',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('role trong token khác role trong DB → INVALID_TOKEN', async () => {
      const { service, seedUser, payloadFor } = setup();
      const user = seedUser('ACTIVE');

      await expect(
        service.authenticate(payloadFor(user, 'ADMIN')),
      ).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });

    it('token từ login hợp lệ; sau khi đặt lại mật khẩu → TOKEN_REVOKED (401)', async () => {
      const { clock, jwt, mailer, service, seedUser } = setup();
      seedUser('ACTIVE');
      const { accessToken } = await service.login(EMAIL, PASSWORD);
      const payload = await jwt.verifyAsync<JwtPayload>(accessToken);
      await expect(service.authenticate(payload)).resolves.toMatchObject({
        email: EMAIL,
      });

      await service.requestPasswordReset(EMAIL);
      clock.advance(SECOND);
      await service.resetPassword(
        EMAIL,
        extractOtp(mailer.lastTo(EMAIL))!,
        'matkhaumoi456',
      );

      const error = await service
        .authenticate(payload)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error).toMatchObject({ code: 'TOKEN_REVOKED' });
      const fresh = await service.login(EMAIL, 'matkhaumoi456');
      await expect(
        service.authenticate(await jwt.verifyAsync(fresh.accessToken)),
      ).resolves.toMatchObject({ email: EMAIL });
    });

    it('payload thiếu pwv (token cũ trước khi có claim) → TOKEN_REVOKED', async () => {
      const { service, seedUser } = setup();
      const user = seedUser('ACTIVE');

      await expect(
        service.authenticate({ sub: user.id, role: 'CUSTOMER' } as JwtPayload),
      ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    });
  });

  describe('requestPasswordReset', () => {
    it('user ACTIVE → OTP PASSWORD_RESET, gửi email đặt lại mật khẩu', async () => {
      const { otpRepo, mailer, service, seedUser } = setup();
      const user = seedUser('ACTIVE');

      await service.requestPasswordReset(EMAIL);

      expect(otpRepo.rows).toHaveLength(1);
      expect(otpRepo.rows[0]).toMatchObject({
        userId: user.id,
        purpose: 'PASSWORD_RESET',
      });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({
        to: EMAIL,
        subject: 'Mã OTP đặt lại mật khẩu',
      });
      expect(extractOtp(mailer.sent[0])).toMatch(/^\d{6}$/);
    });

    it('email không tồn tại → không lỗi, không gửi gì', async () => {
      const { mailer, otpRepo, service } = setup();

      await expect(
        service.requestPasswordReset('khong-co@example.com'),
      ).resolves.toBeUndefined();
      expect(mailer.sent).toHaveLength(0);
      expect(otpRepo.rows).toHaveLength(0);
    });

    it.each(['INVITED', 'LOCKED', 'INACTIVE'] as const)(
      'user %s → không lỗi, không gửi gì',
      async (status) => {
        const { mailer, otpRepo, service, seedUser } = setup();
        seedUser(status);

        await service.requestPasswordReset(EMAIL);

        expect(mailer.sent).toHaveLength(0);
        expect(otpRepo.rows).toHaveLength(0);
      },
    );

    it('trong cooldown → không lỗi (không lộ email), không gửi thêm; hết cooldown → gửi mới', async () => {
      const { clock, mailer, service, seedUser } = setup();
      seedUser('ACTIVE');
      await service.requestPasswordReset(EMAIL);
      clock.advance(10 * SECOND);

      await expect(
        service.requestPasswordReset(EMAIL),
      ).resolves.toBeUndefined();
      expect(mailer.sent).toHaveLength(1);

      clock.advance(50 * SECOND);
      await service.requestPasswordReset(EMAIL);
      expect(mailer.sent).toHaveLength(2);
    });

    it('cooldown tính riêng theo purpose: OTP kích hoạt vừa gửi không chặn OTP reset', async () => {
      const { mailer, service, register } = setup();
      await register();
      await service.verifyEmail(EMAIL, extractOtp(mailer.lastTo(EMAIL))!);

      await service.requestPasswordReset(EMAIL);

      expect(mailer.sent).toHaveLength(2);
    });

    it('gửi email lỗi → không ném lỗi', async () => {
      const { mailer, service, seedUser } = setup();
      seedUser('ACTIVE');
      vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        service.requestPasswordReset(EMAIL),
      ).resolves.toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    const NEW_PASSWORD = 'matkhaumoi456';

    async function requestOtp(ctx: ReturnType<typeof setup>): Promise<string> {
      await ctx.service.requestPasswordReset(EMAIL);
      return extractOtp(ctx.mailer.lastTo(EMAIL))!;
    }

    it('OTP đúng → đổi password_hash, đăng nhập bằng mật khẩu mới, mật khẩu cũ bị từ chối', async () => {
      const ctx = setup();
      ctx.seedUser('ACTIVE');
      const code = await requestOtp(ctx);

      await ctx.service.resetPassword(EMAIL, code, NEW_PASSWORD);

      expect(ctx.userRepo.rows[0].passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
      await expect(
        ctx.service.login(EMAIL, NEW_PASSWORD),
      ).resolves.toHaveProperty('accessToken');
      await expect(ctx.service.login(EMAIL, PASSWORD)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('OTP sai → OTP_INVALID, mật khẩu giữ nguyên', async () => {
      const ctx = setup();
      ctx.seedUser('ACTIVE');
      const code = await requestOtp(ctx);

      const error = await ctx.service
        .resetPassword(
          EMAIL,
          code === '000000' ? '000001' : '000000',
          NEW_PASSWORD,
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error).toMatchObject({
        code: 'OTP_INVALID',
        details: { remainingAttempts: 4 },
      });
      expect(ctx.userRepo.rows[0].passwordHash).toBe(`hashed:${PASSWORD}`);
    });

    it('OTP đã dùng → lần thứ hai OTP_INVALID', async () => {
      const ctx = setup();
      ctx.seedUser('ACTIVE');
      const code = await requestOtp(ctx);
      await ctx.service.resetPassword(EMAIL, code, NEW_PASSWORD);

      await expect(
        ctx.service.resetPassword(EMAIL, code, 'matkhaukhac789'),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
      expect(ctx.userRepo.rows[0].passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    });

    it('OTP hết hạn → OTP_EXPIRED', async () => {
      const ctx = setup();
      ctx.seedUser('ACTIVE');
      const code = await requestOtp(ctx);
      ctx.clock.advance(15 * 60 * SECOND);

      await expect(
        ctx.service.resetPassword(EMAIL, code, NEW_PASSWORD),
      ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
    });

    it('OTP ACCOUNT_ACTIVATION không dùng được để đặt lại mật khẩu', async () => {
      const ctx = setup();
      const user = ctx.seedUser('ACTIVE');
      const code = await ctx.otp.issue(user.id, 'ACCOUNT_ACTIVATION');

      await expect(
        ctx.service.resetPassword(EMAIL, code, NEW_PASSWORD),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it.each(['INVITED', 'LOCKED'] as const)(
      'user %s → OTP_INVALID, không đổi mật khẩu',
      async (status) => {
        const ctx = setup();
        ctx.seedUser(status);

        await expect(
          ctx.service.resetPassword(EMAIL, '123456', NEW_PASSWORD),
        ).rejects.toMatchObject({ code: 'OTP_INVALID' });
        expect(ctx.userRepo.rows[0].passwordHash).toBe(`hashed:${PASSWORD}`);
      },
    );

    it('email không tồn tại → OTP_INVALID (không lộ email)', async () => {
      const { service } = setup();

      await expect(
        service.resetPassword('khong-co@example.com', '123456', NEW_PASSWORD),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });
  });

  describe('me', () => {
    it('trả user kèm designer profile', async () => {
      const { userRepo, service, seedUser } = setup();
      const user = seedUser('ACTIVE', { roleId: ROLE_IDS.DESIGNER });
      userRepo.designerProfiles.set(user.id, {
        userId: user.id,
        employeeCode: 'NV001',
      } as DesignerProfile);

      const me = await service.me(user.id);

      expect(me.designerProfile).toMatchObject({ employeeCode: 'NV001' });
      expect(me.supplierProfile).toBeNull();
    });

    it('user không tồn tại → USER_NOT_FOUND', async () => {
      const { service } = setup();

      await expect(
        service.me('33333333-3333-4333-8333-333333333333'),
      ).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });
  });
});
