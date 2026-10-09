import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  TooManyRequestsError,
} from '../../common/errors/index.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { generateOtpCode, hashOtpCode, otpCodeMatches } from './otp-code.js';
import { OTP_CONFIG, type OtpConfig } from './otp.config.js';
import type { OtpPurpose } from './otp.enum.js';
import {
  OTP_REPOSITORY,
  type OtpRepository,
} from './repositories/otp.repository.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

/**
 * OTP dùng chung cho kích hoạt tài khoản (tự đăng ký, nhận lời mời) và đặt lại mật khẩu.
 * Service gọi `issue` rồi tự gửi mã qua `Mailer` sau khi commit.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_REPOSITORY) private readonly otps: OtpRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OTP_CONFIG) private readonly config: OtpConfig,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * Sinh OTP mới (kênh EMAIL), vô hiệu các OTP chưa dùng trước đó cùng user + purpose.
   * Trả mã gốc để gửi email; DB chỉ lưu hash.
   *
   * @param ttlMinutes thời hạn riêng (vd lời mời dùng `inviteTtlHours`); mặc định `OTP_TTL_MINUTES`.
   */
  async issue(
    userId: string,
    purpose: OtpPurpose,
    ttlMinutes: number = this.config.ttlMinutes,
  ): Promise<string> {
    const code = generateOtpCode();
    const now = this.clock.now();
    await this.uow.run(async () => {
      await this.otps.invalidatePending(userId, purpose, now);
      await this.otps.create({
        userId,
        purpose,
        channel: 'EMAIL',
        codeHash: hashOtpCode(this.config.hashKey, userId, purpose, code),
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
    if (otp.attemptCount >= this.config.maxAttempts) {
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

    if (
      !otpCodeMatches(this.config.hashKey, userId, purpose, code, otp.codeHash)
    ) {
      const attempts =
        (await this.otps.incrementAttempts(otp.id)) ?? otp.attemptCount + 1;
      throw new BusinessRuleError('OTP_INVALID', 'Mã OTP không đúng', {
        remainingAttempts: Math.max(0, this.config.maxAttempts - attempts),
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

    const cooldownMs = this.config.resendCooldownSeconds * MS_PER_SECOND;
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
}
