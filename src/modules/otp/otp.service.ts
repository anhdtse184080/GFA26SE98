import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessRuleError,
  TooManyRequestsError,
} from '../../common/errors/index.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import type { OtpPurpose } from './entities/otp-verification.entity.js';
import { OtpRepository } from './otp.repository.js';

const OTP_CODE_LENGTH = 6;
const OTP_CODE_SPACE = 10 ** OTP_CODE_LENGTH;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;
const MINUTES_PER_HOUR = 60;

/**
 * OTP dùng chung cho kích hoạt tài khoản (tự đăng ký, nhận lời mời) và đặt lại mật khẩu.
 * Service gọi `issue` rồi tự gửi mã qua `Mailer` sau khi commit.
 *
 * DB chỉ lưu HMAC-SHA256 của mã, gắn với user và mục đích: lộ DB mà không có khóa thì không
 * dò ngược được 10^6 mã, và hash của user này không dùng được cho user khác.
 */
@Injectable()
export class OtpService {
  /** Thời hạn OTP thường (phút). */
  readonly ttlMinutes: number;
  /** Thời hạn OTP trong email mời kích hoạt (giờ). */
  readonly inviteTtlHours: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;
  /** Khóa HMAC riêng cho OTP, tách miền khỏi việc ký JWT dù dẫn xuất từ cùng secret. */
  private readonly hashKey: Buffer;

  constructor(
    private readonly otps: OtpRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlMinutes = config.get('OTP_TTL_MINUTES', { infer: true });
    this.inviteTtlHours = config.get('INVITE_OTP_TTL_HOURS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
    this.resendCooldownSeconds = config.get('OTP_RESEND_COOLDOWN_SECONDS', {
      infer: true,
    });
    this.hashKey = createHmac(
      'sha256',
      config.get('JWT_SECRET', { infer: true }),
    )
      .update('otp-code-hash')
      .digest();
  }

  /**
   * Sinh OTP mới (kênh EMAIL), vô hiệu các OTP chưa dùng trước đó cùng user + purpose.
   * Trả mã gốc để gửi email; DB chỉ lưu hash. Thời hạn: `ttlMinutes`, riêng lời mời dùng `inviteTtlHours`.
   */
  async issue(
    userId: string,
    purpose: OtpPurpose,
    options: { invitation?: boolean } = {},
  ): Promise<string> {
    // CSPRNG (`crypto.randomInt`), giữ số 0 ở đầu.
    const code = randomInt(OTP_CODE_SPACE)
      .toString()
      .padStart(OTP_CODE_LENGTH, '0');
    const ttlMinutes = options.invitation
      ? this.inviteTtlHours * MINUTES_PER_HOUR
      : this.ttlMinutes;
    const now = this.clock.now();
    await this.uow.run(async () => {
      await this.otps.invalidatePending(userId, purpose, now);
      await this.otps.create({
        userId,
        purpose,
        channel: 'EMAIL',
        codeHash: this.hashCode(userId, purpose, code),
        expiresAt: new Date(now.getTime() + ttlMinutes * MS_PER_MINUTE),
        createdAt: now,
      });
    });
    return code;
  }

  /**
   * Xác thực OTP mới nhất của user + purpose; đúng thì đánh dấu đã dùng.
   *
   * KHÔNG gọi bên trong `UnitOfWork.run` của nơi gọi: lỗi ném ra sẽ rollback
   * việc tăng `attempt_count` và mở đường dò mã. Verify trước, rồi mới mở transaction.
   *
   * @throws BusinessRuleError `OTP_INVALID` – không có OTP, sai mã hoặc đã dùng
   * @throws BusinessRuleError `OTP_EXPIRED`
   * @throws TooManyRequestsError `OTP_TOO_MANY_ATTEMPTS`
   */
  async verify(
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<void> {
    const now = this.clock.now();
    const otp = await this.otps.findLatestUnverified(userId, purpose);
    if (!otp) {
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không hợp lệ');
    }
    if (otp.attemptCount >= this.maxAttempts) {
      throw new TooManyRequestsError(
        'OTP_TOO_MANY_ATTEMPTS',
        'Đã nhập sai quá số lần cho phép, vui lòng yêu cầu mã mới',
      );
    }
    if (otp.expiresAt.getTime() <= now.getTime()) {
      throw new BusinessRuleError(
        'OTP_EXPIRED',
        'Mã OTP đã hết hạn, vui lòng yêu cầu mã mới',
      );
    }

    if (!this.codeMatches(userId, purpose, code, otp.codeHash)) {
      const attempts =
        (await this.otps.incrementAttempts(otp.id)) ?? otp.attemptCount + 1;
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không đúng', {
        remainingAttempts: Math.max(0, this.maxAttempts - attempts),
      });
    }

    if (!(await this.otps.markVerified(otp.id, now))) {
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không hợp lệ');
    }
  }

  /**
   * Chặn gửi lại khi OTP gần nhất mới tạo chưa đủ `resendCooldownSeconds`.
   * Luồng gửi lại gọi hàm này trước `issue`.
   *
   * @throws TooManyRequestsError `OTP_RESEND_TOO_SOON` kèm `details.retryAfterSeconds`
   */
  async assertCanResend(userId: string, purpose: OtpPurpose): Promise<void> {
    const latest = await this.otps.findLatest(userId, purpose);
    if (!latest) return;

    const cooldownMs = this.resendCooldownSeconds * MS_PER_SECOND;
    const elapsedMs = this.clock.now().getTime() - latest.createdAt.getTime();
    if (elapsedMs < cooldownMs) {
      const retryAfterSeconds = Math.ceil(
        (cooldownMs - elapsedMs) / MS_PER_SECOND,
      );
      throw new TooManyRequestsError(
        'OTP_RESEND_TOO_SOON',
        `Vui lòng chờ ${retryAfterSeconds} giây trước khi gửi lại mã`,
        { retryAfterSeconds },
      );
    }
  }

  private hashCode(userId: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.hashKey)
      .update(`${userId}:${purpose}:${code}`)
      .digest('hex');
  }

  /** So sánh thời gian hằng (`timingSafeEqual`). */
  private codeMatches(
    userId: string,
    purpose: OtpPurpose,
    code: string,
    codeHash: string,
  ): boolean {
    const expected = Buffer.from(codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(userId, purpose, code), 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}
