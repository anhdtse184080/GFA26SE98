import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { CLOCK } from './../src/common/ports/clock.js';
import { MAILER } from './../src/common/ports/mailer.js';
import { OtpService } from './../src/modules/auth/otp.service.js';
import { ROLE_IDS } from './../src/modules/users/role-code.enum.js';
import { FakeClock } from './support/fake-clock.js';
import { FakeMailer } from './support/fake-mailer.js';

interface OtpRow {
  id: string;
  channel: string;
  code_hash: string;
  attempt_count: number;
  expires_at: Date;
  verified_at: Date | null;
  created_at: Date;
}

// Cần chạy `npm run db:up` và `npm run migration:run` trước.
describe('OtpService + TypeOrmOtpRepository (e2e, DB thật)', () => {
  const MINUTE = 60_000;
  let app: INestApplication;
  let dataSource: DataSource;
  let otp: OtpService;
  let clock: FakeClock;

  beforeAll(async () => {
    clock = new FakeClock(new Date());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new FakeMailer())
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    otp = app.get(OtpService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(): Promise<string> {
    const [row] = (await dataSource.query(
      `INSERT INTO users (role_id, email, full_name, status, password_hash)
       VALUES ($1, $2, 'OTP e2e', 'INVITED', 'x') RETURNING id`,
      [ROLE_IDS.CUSTOMER, `e2e-otp-${randomUUID()}@example.com`],
    )) as { id: string }[];
    return row.id;
  }

  function otpRows(userId: string): Promise<OtpRow[]> {
    return dataSource.query(
      `SELECT id, channel, code_hash, attempt_count, expires_at, verified_at, created_at
         FROM otp_verifications WHERE user_id = $1 ORDER BY created_at, expires_at`,
      [userId],
    );
  }

  function wrong(code: string): string {
    return code === '000000' ? '000001' : '000000';
  }

  it('issue lưu hash (không lưu mã gốc), kênh EMAIL, created_at/expires_at theo Clock', async () => {
    const userId = await createUser();
    const now = clock.now();

    const code = await otp.issue(userId, 'ACCOUNT_ACTIVATION');

    const [row] = await otpRows(userId);
    expect(code).toMatch(/^\d{6}$/);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code_hash).not.toContain(code);
    expect(row.channel).toBe('EMAIL');
    expect(row.attempt_count).toBe(0);
    expect(row.verified_at).toBeNull();
    expect(row.created_at).toEqual(now);
    expect(row.expires_at).toEqual(new Date(now.getTime() + 15 * MINUTE));
  });

  it('issue lại vô hiệu OTP cũ; mã cũ bị từ chối, mã mới dùng được', async () => {
    const userId = await createUser();
    const oldCode = await otp.issue(userId, 'PASSWORD_RESET');
    clock.advance(MINUTE);
    const issuedAt = clock.now();

    const newCode = await otp.issue(userId, 'PASSWORD_RESET');

    const [oldRow, newRow] = await otpRows(userId);
    expect(oldRow.expires_at).toEqual(issuedAt);
    expect(newRow.expires_at).toEqual(
      new Date(issuedAt.getTime() + 15 * MINUTE),
    );
    if (oldCode !== newCode) {
      await expect(
        otp.verify(userId, 'PASSWORD_RESET', oldCode),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
    await otp.verify(userId, 'PASSWORD_RESET', newCode);
    const [, verified] = await otpRows(userId);
    expect(verified.verified_at).toEqual(issuedAt);
  });

  it('issue lại cùng thời điểm vẫn chọn đúng OTP mới', async () => {
    const userId = await createUser();
    await otp.issue(userId, 'PASSWORD_RESET');

    const newCode = await otp.issue(userId, 'PASSWORD_RESET');

    await expect(
      otp.verify(userId, 'PASSWORD_RESET', newCode),
    ).resolves.toBeUndefined();
  });

  it('mã sai tăng attempt_count trong DB; quá 5 lần → OTP_TOO_MANY_ATTEMPTS', async () => {
    const userId = await createUser();
    const code = await otp.issue(userId, 'ACCOUNT_ACTIVATION');

    await expect(
      otp.verify(userId, 'ACCOUNT_ACTIVATION', wrong(code)),
    ).rejects.toMatchObject({
      code: 'OTP_INVALID',
      details: { remainingAttempts: 4 },
    });
    expect((await otpRows(userId))[0].attempt_count).toBe(1);

    for (let i = 0; i < 4; i++) {
      await otp
        .verify(userId, 'ACCOUNT_ACTIVATION', wrong(code))
        .catch(() => undefined);
    }
    expect((await otpRows(userId))[0].attempt_count).toBe(5);

    await expect(
      otp.verify(userId, 'ACCOUNT_ACTIVATION', code),
    ).rejects.toMatchObject({ code: 'OTP_TOO_MANY_ATTEMPTS' });
    expect((await otpRows(userId))[0].verified_at).toBeNull();
  });

  it('hết hạn → OTP_EXPIRED', async () => {
    const userId = await createUser();
    const code = await otp.issue(userId, 'ACCOUNT_ACTIVATION');
    clock.advance(15 * MINUTE);

    await expect(
      otp.verify(userId, 'ACCOUNT_ACTIVATION', code),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('cooldown gửi lại tính theo created_at trong DB', async () => {
    const userId = await createUser();
    await otp.issue(userId, 'ACCOUNT_ACTIVATION');
    clock.advance(20_000);

    await expect(
      otp.assertCanResend(userId, 'ACCOUNT_ACTIVATION'),
    ).rejects.toMatchObject({
      code: 'OTP_RESEND_TOO_SOON',
      details: { retryAfterSeconds: 40 },
    });

    clock.advance(40_000);
    await expect(
      otp.assertCanResend(userId, 'ACCOUNT_ACTIVATION'),
    ).resolves.toBeUndefined();
  });
});
