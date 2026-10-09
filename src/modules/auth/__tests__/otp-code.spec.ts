import {
  deriveOtpHashKey,
  generateOtpCode,
  hashOtpCode,
  otpCodeMatches,
} from '../otp-code.js';

const key = deriveOtpHashKey('x'.repeat(32));
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';

describe('otp-code', () => {
  it('sinh mã đúng 6 chữ số', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('giữ số 0 ở đầu và lấy số trong [0, 10^6)', () => {
    const random = vi.fn(() => 42);
    expect(generateOtpCode(random)).toBe('000042');
    expect(random).toHaveBeenCalledWith(1_000_000);
  });

  it('không dùng Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      generateOtpCode();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('hash khác mã gốc, ổn định, phụ thuộc user/purpose/khóa', () => {
    const hash = hashOtpCode(key, userId, 'ACCOUNT_ACTIVATION', '123456');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
    expect(hashOtpCode(key, userId, 'ACCOUNT_ACTIVATION', '123456')).toBe(hash);
    expect(hashOtpCode(key, userId, 'PASSWORD_RESET', '123456')).not.toBe(hash);
    expect(
      hashOtpCode(key, otherUserId, 'ACCOUNT_ACTIVATION', '123456'),
    ).not.toBe(hash);
    expect(
      hashOtpCode(
        deriveOtpHashKey('y'.repeat(32)),
        userId,
        'ACCOUNT_ACTIVATION',
        '123456',
      ),
    ).not.toBe(hash);
  });

  it('otpCodeMatches: đúng → true, sai → false, hash hỏng không ném lỗi', () => {
    const hash = hashOtpCode(key, userId, 'PASSWORD_RESET', '654321');

    expect(otpCodeMatches(key, userId, 'PASSWORD_RESET', '654321', hash)).toBe(
      true,
    );
    expect(otpCodeMatches(key, userId, 'PASSWORD_RESET', '654320', hash)).toBe(
      false,
    );
    expect(otpCodeMatches(key, userId, 'PASSWORD_RESET', '', hash)).toBe(false);
    expect(otpCodeMatches(key, userId, 'PASSWORD_RESET', '654321', 'abc')).toBe(
      false,
    );
  });
});
