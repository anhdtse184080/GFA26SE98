import type { OtpVerification } from '../entities/otp-verification.entity.js';
import type { OtpPurpose } from '../otp.enum.js';

export const OTP_REPOSITORY = Symbol('OTP_REPOSITORY');

export type NewOtp = Pick<
  OtpVerification,
  'userId' | 'purpose' | 'channel' | 'codeHash' | 'expiresAt' | 'createdAt'
>;

/** `otp_verifications`. Không có `delete`: OTP chỉ hết hạn hoặc được xác thực. */
export interface OtpRepository {
  create(otp: NewOtp): Promise<OtpVerification>;

  /** OTP mới nhất (theo `created_at`) của user + purpose, kể cả đã dùng/hết hạn. */
  findLatest(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<OtpVerification | null>;

  /** OTP chưa xác thực mới nhất của user + purpose (có thể đã hết hạn). */
  findLatestUnverified(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<OtpVerification | null>;

  /** Cho các OTP chưa dùng và còn hạn hết hạn ngay tại `at`. Trả số bản ghi bị ảnh hưởng. */
  invalidatePending(
    userId: string,
    purpose: OtpPurpose,
    at: Date,
  ): Promise<number>;

  /** Tăng `attempt_count` nguyên tử. Trả giá trị mới, `null` nếu không tìm thấy. */
  incrementAttempts(id: string): Promise<number | null>;

  /** Đặt `verified_at` nếu chưa xác thực. `false` nếu OTP đã được dùng hoặc không tồn tại. */
  markVerified(id: string, at: Date): Promise<boolean>;
}
