export const OTP_CONFIG = Symbol('OTP_CONFIG');

export interface OtpConfig {
  ttlMinutes: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  /** Khóa HMAC để hash mã (xem `deriveOtpHashKey`). */
  hashKey: Buffer;
}
