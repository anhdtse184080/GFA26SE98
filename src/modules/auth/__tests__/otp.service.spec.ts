import {
  BusinessRuleError,
  TooManyRequestsError,
} from '../../../common/errors/index.js';
import type { UnitOfWork } from '../../../database/unit-of-work.js';
import { FakeClock } from '../../../../test/support/fake-clock.js';
import { deriveOtpHashKey } from '../otp-code.js';
import type { OtpConfig } from '../otp.config.js';
import { OtpService } from '../otp.service.js';
import { InMemoryOtpRepository } from './in-memory-otp.repository.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const T0 = new Date('2026-10-09T08:00:00.000Z');
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

const fakeUow = {
  run: <T>(fn: () => Promise<T>) => fn(),
} as unknown as UnitOfWork;

function setup(overrides: Partial<OtpConfig> = {}) {
  const repo = new InMemoryOtpRepository();
  const clock = new FakeClock(T0);
  const config: OtpConfig = {
    ttlMinutes: 15,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
    hashKey: deriveOtpHashKey('x'.repeat(32)),
    ...overrides,
  };
  const service = new OtpService(repo, clock, config, fakeUow);
  return { repo, clock, service };
}

/** Mã sai chắc chắn khác mã đúng. */
function wrong(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

describe('OtpService', () => {
  describe('issue', () => {
    it('trả mã 6 chữ số, lưu hash (không lưu mã gốc), kênh EMAIL, hết hạn sau 15 phút', async () => {
      const { repo, service } = setup();

      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');

      expect(code).toMatch(/^\d{6}$/);
      expect(repo.rows).toHaveLength(1);
      const [row] = repo.rows;
      expect(row).toMatchObject({
        userId: USER,
        purpose: 'ACCOUNT_ACTIVATION',
        channel: 'EMAIL',
        attemptCount: 0,
        verifiedAt: null,
        createdAt: T0,
        expiresAt: new Date(T0.getTime() + 15 * MINUTE),
      });
      expect(row.codeHash).not.toBe(code);
      expect(row.codeHash).not.toContain(code);
    });

    it('vô hiệu OTP cũ chưa dùng cùng user + purpose', async () => {
      const { repo, clock, service } = setup();
      const oldCode = await service.issue(USER, 'PASSWORD_RESET');
      clock.advance(2 * MINUTE);

      const newCode = await service.issue(USER, 'PASSWORD_RESET');

      expect(repo.rows[0].expiresAt).toEqual(clock.now());
      if (oldCode !== newCode) {
        await expect(
          service.verify(USER, 'PASSWORD_RESET', oldCode),
        ).rejects.toMatchObject({ code: 'OTP_INVALID' });
      }
      await expect(
        service.verify(USER, 'PASSWORD_RESET', newCode),
      ).resolves.toBeUndefined();
    });

    it('OTP cũ bị vô hiệu kể cả khi issue lại cùng thời điểm', async () => {
      const { repo, service } = setup();
      await service.issue(USER, 'PASSWORD_RESET');

      const newCode = await service.issue(USER, 'PASSWORD_RESET');

      expect(repo.rows[0].expiresAt).toEqual(T0);
      await expect(
        service.verify(USER, 'PASSWORD_RESET', newCode),
      ).resolves.toBeUndefined();
      expect(repo.rows[1].verifiedAt).toEqual(T0);
    });

    it('không đụng tới OTP của purpose khác hoặc user khác', async () => {
      const { service } = setup();
      const activation = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      const other = await service.issue(OTHER_USER, 'PASSWORD_RESET');

      await service.issue(USER, 'PASSWORD_RESET');

      await expect(
        service.verify(USER, 'ACCOUNT_ACTIVATION', activation),
      ).resolves.toBeUndefined();
      await expect(
        service.verify(OTHER_USER, 'PASSWORD_RESET', other),
      ).resolves.toBeUndefined();
    });

    it('áp dụng ttlMinutes cấu hình', async () => {
      const { repo, service } = setup({ ttlMinutes: 5 });

      await service.issue(USER, 'ACCOUNT_ACTIVATION');

      expect(repo.rows[0].expiresAt).toEqual(
        new Date(T0.getTime() + 5 * MINUTE),
      );
    });
  });

  describe('verify', () => {
    it('mã đúng → set verified_at, không dùng lại được', async () => {
      const { repo, clock, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      clock.advance(3 * MINUTE);

      await service.verify(USER, 'ACCOUNT_ACTIVATION', code);

      expect(repo.rows[0].verifiedAt).toEqual(clock.now());
      expect(repo.rows[0].attemptCount).toBe(0);
      await expect(
        service.verify(USER, 'ACCOUNT_ACTIVATION', code),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it('mã sai → OTP_INVALID, tăng attempt_count, báo số lượt còn lại', async () => {
      const { repo, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');

      const error = await service
        .verify(USER, 'ACCOUNT_ACTIVATION', wrong(code))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error).toMatchObject({
        code: 'OTP_INVALID',
        details: { remainingAttempts: 4 },
      });
      expect(repo.rows[0].attemptCount).toBe(1);
      expect(repo.rows[0].verifiedAt).toBeNull();
    });

    it('sai sau đó đúng (chưa quá số lần) vẫn xác thực được', async () => {
      const { repo, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      for (let i = 0; i < 4; i++) {
        await service
          .verify(USER, 'ACCOUNT_ACTIVATION', wrong(code))
          .catch(() => undefined);
      }

      await service.verify(USER, 'ACCOUNT_ACTIVATION', code);

      expect(repo.rows[0].attemptCount).toBe(4);
      expect(repo.rows[0].verifiedAt).toEqual(T0);
    });

    it('sai đủ 5 lần → lần sau (kể cả mã đúng) bị OTP_TOO_MANY_ATTEMPTS', async () => {
      const { repo, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      const remaining: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const e = (await service
          .verify(USER, 'ACCOUNT_ACTIVATION', wrong(code))
          .catch((err: unknown) => err)) as BusinessRuleError;
        expect(e.code).toBe('OTP_INVALID');
        remaining.push(e.details.remainingAttempts);
      }
      expect(remaining).toEqual([4, 3, 2, 1, 0]);

      const error = await service
        .verify(USER, 'ACCOUNT_ACTIVATION', code)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TooManyRequestsError);
      expect(error).toMatchObject({ code: 'OTP_TOO_MANY_ATTEMPTS' });
      expect(repo.rows[0].attemptCount).toBe(5);
      expect(repo.rows[0].verifiedAt).toBeNull();
    });

    it('áp dụng maxAttempts cấu hình', async () => {
      const { service } = setup({ maxAttempts: 2 });
      const code = await service.issue(USER, 'PASSWORD_RESET');
      await service.verify(USER, 'PASSWORD_RESET', wrong(code)).catch(() => 0);
      await service.verify(USER, 'PASSWORD_RESET', wrong(code)).catch(() => 0);

      await expect(
        service.verify(USER, 'PASSWORD_RESET', code),
      ).rejects.toMatchObject({ code: 'OTP_TOO_MANY_ATTEMPTS' });
    });

    it('issue mã mới sau khi bị khóa vì sai nhiều lần → dùng được mã mới', async () => {
      const { service } = setup({ maxAttempts: 1 });
      const first = await service.issue(USER, 'PASSWORD_RESET');
      await service.verify(USER, 'PASSWORD_RESET', wrong(first)).catch(() => 0);

      const second = await service.issue(USER, 'PASSWORD_RESET');

      await expect(
        service.verify(USER, 'PASSWORD_RESET', second),
      ).resolves.toBeUndefined();
    });

    it('hết hạn đúng tại expires_at → OTP_EXPIRED, không tăng attempt_count', async () => {
      const { repo, clock, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      clock.advance(15 * MINUTE);

      const error = await service
        .verify(USER, 'ACCOUNT_ACTIVATION', code)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error).toMatchObject({ code: 'OTP_EXPIRED' });
      expect(repo.rows[0].attemptCount).toBe(0);
      expect(repo.rows[0].verifiedAt).toBeNull();
    });

    it('còn 1 giây trước khi hết hạn → vẫn xác thực được', async () => {
      const { clock, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      clock.advance(15 * MINUTE - SECOND);

      await expect(
        service.verify(USER, 'ACCOUNT_ACTIVATION', code),
      ).resolves.toBeUndefined();
    });

    it('chưa có OTP nào → OTP_INVALID', async () => {
      const { service } = setup();

      await expect(
        service.verify(USER, 'ACCOUNT_ACTIVATION', '123456'),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it('mã của purpose này không dùng được cho purpose khác', async () => {
      const { service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      await service.issue(USER, 'PASSWORD_RESET');

      await expect(
        service.verify(USER, 'PASSWORD_RESET', code),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it('mã của user này không dùng được cho user khác', async () => {
      const { service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      await service.issue(OTHER_USER, 'ACCOUNT_ACTIVATION');

      await expect(
        service.verify(OTHER_USER, 'ACCOUNT_ACTIVATION', code),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });

    it('OTP bị dùng đồng thời (markVerified trả false) → OTP_INVALID', async () => {
      const { repo, service } = setup();
      const code = await service.issue(USER, 'ACCOUNT_ACTIVATION');
      vi.spyOn(repo, 'markVerified').mockResolvedValueOnce(false);

      await expect(
        service.verify(USER, 'ACCOUNT_ACTIVATION', code),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    });
  });

  describe('assertCanResend', () => {
    it('chưa có OTP nào → cho gửi', async () => {
      const { service } = setup();

      await expect(
        service.assertCanResend(USER, 'ACCOUNT_ACTIVATION'),
      ).resolves.toBeUndefined();
    });

    it('trong 60 giây → OTP_RESEND_TOO_SOON kèm số giây còn lại', async () => {
      const { clock, service } = setup();
      await service.issue(USER, 'ACCOUNT_ACTIVATION');

      const immediately = await service
        .assertCanResend(USER, 'ACCOUNT_ACTIVATION')
        .catch((e: unknown) => e);
      expect(immediately).toBeInstanceOf(TooManyRequestsError);
      expect(immediately).toMatchObject({
        code: 'OTP_RESEND_TOO_SOON',
        details: { retryAfterSeconds: 60 },
      });

      clock.advance(45 * SECOND);
      await expect(
        service.assertCanResend(USER, 'ACCOUNT_ACTIVATION'),
      ).rejects.toMatchObject({ details: { retryAfterSeconds: 15 } });

      clock.advance(14 * SECOND + 500);
      await expect(
        service.assertCanResend(USER, 'ACCOUNT_ACTIVATION'),
      ).rejects.toMatchObject({ details: { retryAfterSeconds: 1 } });
    });

    it('đủ 60 giây → cho gửi', async () => {
      const { clock, service } = setup();
      await service.issue(USER, 'ACCOUNT_ACTIVATION');
      clock.advance(60 * SECOND);

      await expect(
        service.assertCanResend(USER, 'ACCOUNT_ACTIVATION'),
      ).resolves.toBeUndefined();
    });

    it('tính theo OTP gần nhất, kể cả OTP đã được xác thực', async () => {
      const { clock, service } = setup();
      await service.issue(USER, 'PASSWORD_RESET');
      clock.advance(2 * MINUTE);
      const code = await service.issue(USER, 'PASSWORD_RESET');
      await service.verify(USER, 'PASSWORD_RESET', code);
      clock.advance(10 * SECOND);

      await expect(
        service.assertCanResend(USER, 'PASSWORD_RESET'),
      ).rejects.toMatchObject({ details: { retryAfterSeconds: 50 } });
    });

    it('cooldown tách biệt theo purpose và user', async () => {
      const { service } = setup();
      await service.issue(USER, 'ACCOUNT_ACTIVATION');

      await expect(
        service.assertCanResend(USER, 'PASSWORD_RESET'),
      ).resolves.toBeUndefined();
      await expect(
        service.assertCanResend(OTHER_USER, 'ACCOUNT_ACTIVATION'),
      ).resolves.toBeUndefined();
    });

    it('áp dụng resendCooldownSeconds cấu hình', async () => {
      const { clock, service } = setup({ resendCooldownSeconds: 30 });
      await service.issue(USER, 'ACCOUNT_ACTIVATION');
      clock.advance(30 * SECOND);

      await expect(
        service.assertCanResend(USER, 'ACCOUNT_ACTIVATION'),
      ).resolves.toBeUndefined();
    });
  });
});
