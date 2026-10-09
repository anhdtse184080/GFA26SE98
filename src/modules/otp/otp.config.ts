export const OTP_CONFIG = Symbol('OTP_CONFIG');

export interface OtpConfig {
  ttlMinutes: number;
  /** Thời hạn OTP trong email mời kích hoạt (Staff/Designer/Supplier do Admin tạo). */
  inviteTtlHours: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  /** Khóa HMAC để hash mã (xem `deriveOtpHashKey`). */
  hashKey: Buffer;
}
