import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpPurpose } from './otp.enum.js';

export const OTP_CODE_LENGTH = 6;

const OTP_CODE_SPACE = 10 ** OTP_CODE_LENGTH;

/** Sinh mã OTP 6 chữ số bằng CSPRNG (`crypto.randomInt`), giữ số 0 ở đầu. */
export function generateOtpCode(
  random: (max: number) => number = randomInt,
): string {
  return random(OTP_CODE_SPACE).toString().padStart(OTP_CODE_LENGTH, '0');
}

/** Khóa HMAC riêng cho OTP, tách miền khỏi việc ký JWT dù dẫn xuất từ cùng secret. */
export function deriveOtpHashKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('otp-code-hash').digest();
}

/**
 * HMAC-SHA256 của mã, gắn với user và mục đích: lộ DB mà không có khóa
 * thì không dò ngược được 10^6 mã, và hash của user này không dùng được cho user khác.
 */
export function hashOtpCode(
  key: Buffer,
  userId: string,
  purpose: OtpPurpose,
  code: string,
): string {
  return createHmac('sha256', key)
    .update(`${userId}:${purpose}:${code}`)
    .digest('hex');
}

/** So sánh thời gian hằng (`timingSafeEqual`). */
export function otpCodeMatches(
  key: Buffer,
  userId: string,
  purpose: OtpPurpose,
  code: string,
  codeHash: string,
): boolean {
  const expected = Buffer.from(codeHash, 'hex');
  const actual = Buffer.from(hashOtpCode(key, userId, purpose, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
