import {
  derivePasswordFingerprintKey,
  passwordFingerprint,
  passwordFingerprintMatches,
} from '../password-fingerprint.js';

const KEY = derivePasswordFingerprintKey('s'.repeat(32));
const HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

describe('passwordFingerprint', () => {
  it('tất định, 16 ký tự base64url, không chứa hash gốc', () => {
    const pwv = passwordFingerprint(KEY, HASH);

    expect(pwv).toBe(passwordFingerprint(KEY, HASH));
    expect(pwv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(HASH).not.toContain(pwv);
  });

  it('khóa dẫn xuất khác với secret gốc', () => {
    expect(KEY.equals(Buffer.from('s'.repeat(32)))).toBe(false);
  });
});

describe('passwordFingerprintMatches', () => {
  it('cùng hash → khớp', () => {
    expect(
      passwordFingerprintMatches(KEY, HASH, passwordFingerprint(KEY, HASH)),
    ).toBe(true);
  });

  it('hash đổi (đã đặt lại mật khẩu) → không khớp', () => {
    const old = passwordFingerprint(KEY, HASH);

    expect(passwordFingerprintMatches(KEY, `${HASH}x`, old)).toBe(false);
  });

  it('khóa khác → không khớp', () => {
    const otherKey = derivePasswordFingerprintKey('t'.repeat(32));

    expect(
      passwordFingerprintMatches(
        KEY,
        HASH,
        passwordFingerprint(otherKey, HASH),
      ),
    ).toBe(false);
  });

  it.each([undefined, null, 123, '', 'ngan'])(
    'pwv %s (thiếu / sai kiểu / sai độ dài) → false',
    (pwv) => {
      expect(passwordFingerprintMatches(KEY, HASH, pwv)).toBe(false);
    },
  );
});
