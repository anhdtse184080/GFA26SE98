import { createHmac, timingSafeEqual } from 'node:crypto';

/** Injection token cho khóa HMAC (Buffer) dùng tính `pwv`. */
export const PASSWORD_FINGERPRINT_KEY = Symbol('PASSWORD_FINGERPRINT_KEY');

const FINGERPRINT_LENGTH = 16;

/** Khóa HMAC riêng cho dấu vân tay mật khẩu, tách miền khỏi việc ký JWT và hash OTP. */
export function derivePasswordFingerprintKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('password-fingerprint').digest();
}

/**
 * Claim `pwv` của JWT: HMAC của `password_hash` hiện tại. Đổi mật khẩu → hash mới
 * → mọi token phát hành trước đó không còn khớp. Có khóa nên không lộ hash mật khẩu.
 */
export function passwordFingerprint(key: Buffer, passwordHash: string): string {
  return createHmac('sha256', key)
    .update(passwordHash)
    .digest('base64url')
    .slice(0, FINGERPRINT_LENGTH);
}

/** So sánh thời gian hằng; `pwv` thiếu hoặc sai kiểu → false. */
export function passwordFingerprintMatches(
  key: Buffer,
  passwordHash: string,
  pwv: unknown,
): boolean {
  if (typeof pwv !== 'string') return false;
  const expected = Buffer.from(passwordFingerprint(key, passwordHash));
  const actual = Buffer.from(pwv);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
