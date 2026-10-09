import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import type { AuthUser } from './../src/common/auth/auth-user.js';
import { CurrentUser, Roles } from './../src/common/auth/decorators.js';
import { CLOCK } from './../src/common/ports/clock.js';
import { MAILER } from './../src/common/ports/mailer.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './../src/common/ports/password-hasher.js';
import { ROLE_IDS } from './../src/modules/users/role-code.enum.js';
import { FakeClock } from './support/fake-clock.js';
import { extractOtp, FakeMailer } from './support/fake-mailer.js';

/** Route chỉ có trong test để kiểm tra RolesGuard toàn cục. */
@Controller('__test__/auth')
class RolesTestController {
  @Roles('ADMIN')
  @Get('admin-only')
  adminOnly(@CurrentUser() user: AuthUser) {
    return { id: user.id, role: user.role };
  }
}

interface UserRow {
  id: string;
  role_id: number;
  status: string;
  created_by: string | null;
  password_hash: string | null;
  activated_at: Date | null;
  last_login_at: Date | null;
}

const PASSWORD = 'matkhau123';
const SECOND = 1_000;

function randomEmail(): string {
  return `e2e-auth-${randomUUID()}@example.com`;
}

async function createApp(options: { throttleLimit: number }) {
  const mailer = new FakeMailer();
  const clock = new FakeClock(new Date());
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [RolesTestController],
  })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(getOptionsToken())
    .useValue([{ ttl: 60 * SECOND, limit: options.throttleLimit }])
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: ['error', 'warn'],
  });
  await app.init();
  return { app, mailer, clock, dataSource: app.get(DataSource) };
}

// Cần chạy `npm run db:up`, `npm run migration:run` và `npm run seed` (roles) trước.
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let mailer: FakeMailer;
  let clock: FakeClock;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app, mailer, clock, dataSource } = await createApp({
      throttleLimit: 1000,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  function register(email: string, extra: Record<string, unknown> = {}) {
    return http()
      .post('/auth/register')
      .send({
        email,
        fullName: 'Khách E2E',
        phone: '0901234567',
        password: PASSWORD,
        ...extra,
      });
  }

  function login(email: string, password = PASSWORD) {
    return http().post('/auth/login').send({ email, password });
  }

  function otpFor(email: string): string {
    const otp = extractOtp(mailer.lastTo(email));
    if (!otp) throw new Error(`Không có OTP gửi tới ${email}`);
    return otp;
  }

  async function userRow(email: string): Promise<UserRow | undefined> {
    const rows = (await dataSource.query(
      `SELECT id, role_id, status, created_by, password_hash, activated_at, last_login_at
         FROM users WHERE email = $1`,
      [email],
    )) as UserRow[];
    return rows[0];
  }

  /** Customer đã đăng ký + xác thực, trả access token. */
  async function activeCustomer(): Promise<{ email: string; token: string }> {
    const email = randomEmail();
    await register(email).expect(201);
    await http()
      .post('/auth/verify-email')
      .send({ email, otp: otpFor(email) })
      .expect(200);
    const res = await login(email).expect(200);
    return { email, token: (res.body as { accessToken: string }).accessToken };
  }

  /** Tạo thẳng trong DB tài khoản do Admin tạo (luồng Admin làm ở phase sau). */
  async function insertStaffLikeUser(
    roleId: number,
    status: string,
    passwordHash: string | null,
  ): Promise<{ id: string; email: string }> {
    const email = randomEmail();
    const [row] = (await dataSource.query(
      `INSERT INTO users (role_id, email, full_name, status, password_hash, activated_at)
       VALUES ($1, $2, 'Nhân viên E2E', $3::varchar, $4, CASE WHEN $3::varchar = 'ACTIVE' THEN now() END)
       RETURNING id`,
      [roleId, email, status, passwordHash],
    )) as { id: string }[];
    return { id: row.id, email };
  }

  describe('luồng chính: register → login bị chặn → verify-email → login → me', () => {
    it('chạy đúng từ đầu tới cuối', async () => {
      const email = randomEmail();

      // 1. Đăng ký: email chuẩn hóa, CUSTOMER, INVITED, created_by null, không lộ password_hash
      const reg = await register(`  ${email.toUpperCase()} `).expect(201);
      expect(reg.body).toMatchObject({
        user: { email, role: 'CUSTOMER', status: 'INVITED', activatedAt: null },
      });
      expect(reg.body.user).not.toHaveProperty('passwordHash');
      const created = await userRow(email);
      expect(created).toMatchObject({
        role_id: ROLE_IDS.CUSTOMER,
        status: 'INVITED',
        created_by: null,
      });
      expect(created?.password_hash).toMatch(/^\$2[aby]\$/);

      // 2. Chưa xác thực → không đăng nhập được
      const blocked = await login(email).expect(403);
      expect(blocked.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

      // 3. Xác thực bằng OTP gửi qua email
      const verified = await http()
        .post('/auth/verify-email')
        .send({ email, otp: otpFor(email) })
        .expect(200);
      expect(verified.body.user).toMatchObject({ status: 'ACTIVE' });
      expect((await userRow(email))?.activated_at).not.toBeNull();

      // 4. Đăng nhập thành công, cập nhật last_login_at
      const ok = await login(email).expect(200);
      const body = ok.body as { accessToken: string; user: unknown };
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user).toMatchObject({ email, role: 'CUSTOMER' });
      expect((await userRow(email))?.last_login_at).not.toBeNull();
      const payload = JSON.parse(
        Buffer.from(body.accessToken.split('.')[1], 'base64url').toString(),
      ) as Record<string, unknown>;
      expect(payload).toMatchObject({
        sub: created?.id,
        role: 'CUSTOMER',
      });
      expect((payload.exp as number) - (payload.iat as number)).toBe(86_400);

      // 5. /auth/me
      const me = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({
        id: created?.id,
        email,
        fullName: 'Khách E2E',
        phone: '0901234567',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        profile: null,
      });
      expect(me.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('POST /auth/register – lỗi', () => {
    it('email đã ACTIVE → 409 EMAIL_ALREADY_EXISTS (kể cả khác hoa thường)', async () => {
      const { email } = await activeCustomer();

      const res = await register(email.toUpperCase()).expect(409);

      expect(res.body).toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
    });

    it('email còn INVITED → 409 EMAIL_NOT_VERIFIED, gợi ý resend', async () => {
      const email = randomEmail();
      await register(email).expect(201);

      const res = await register(email).expect(409);

      expect(res.body).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
        details: { resendEndpoint: '/auth/resend-otp' },
      });
    });

    it('gửi role=ADMIN → 400 VALIDATION_ERROR, không tạo user', async () => {
      const email = randomEmail();

      const res = await register(email, { role: 'ADMIN' }).expect(400);

      expect(res.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { fields: [{ field: 'role' }] },
      });
      expect(await userRow(email)).toBeUndefined();
    });

    it('gửi roleId / status / createdBy → 400, không tạo user', async () => {
      const email = randomEmail();

      await register(email, {
        roleId: ROLE_IDS.ADMIN,
        status: 'ACTIVE',
        createdBy: randomUUID(),
      }).expect(400);

      expect(await userRow(email)).toBeUndefined();
    });

    it('mật khẩu yếu / email sai → 400 kèm field lỗi', async () => {
      const res = await http()
        .post('/auth/register')
        .send({
          email: 'khong-phai-email',
          fullName: 'A',
          password: '12345678',
        })
        .expect(400);

      const fields = (res.body.details.fields as { field: string }[]).map(
        (f) => f.field,
      );
      expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
    });
  });

  describe('POST /auth/verify-email – lỗi', () => {
    it('OTP sai → 422 OTP_INVALID, vẫn INVITED', async () => {
      const email = randomEmail();
      await register(email).expect(201);
      const otp = otpFor(email);

      const res = await http()
        .post('/auth/verify-email')
        .send({ email, otp: otp === '000000' ? '000001' : '000000' })
        .expect(422);

      expect(res.body).toMatchObject({
        code: 'OTP_INVALID',
        details: { remainingAttempts: 4 },
      });
      expect((await userRow(email))?.status).toBe('INVITED');
    });

    it('email không tồn tại → 422 OTP_INVALID', async () => {
      const res = await http()
        .post('/auth/verify-email')
        .send({ email: randomEmail(), otp: '123456' })
        .expect(422);

      expect(res.body).toMatchObject({ code: 'OTP_INVALID' });
    });

    it('OTP không đúng định dạng → 400', async () => {
      await http()
        .post('/auth/verify-email')
        .send({ email: randomEmail(), otp: '12ab' })
        .expect(400);
    });

    it('đã xác thực rồi → 409 EMAIL_ALREADY_VERIFIED', async () => {
      const { email } = await activeCustomer();

      const res = await http()
        .post('/auth/verify-email')
        .send({ email, otp: '123456' })
        .expect(409);

      expect(res.body).toMatchObject({ code: 'EMAIL_ALREADY_VERIFIED' });
    });

    it('tài khoản do Admin mời → 422 ACCEPT_INVITE_REQUIRED', async () => {
      const { email } = await insertStaffLikeUser(
        ROLE_IDS.STAFF,
        'INVITED',
        null,
      );

      const res = await http()
        .post('/auth/verify-email')
        .send({ email, otp: '123456' })
        .expect(422);

      expect(res.body).toMatchObject({ code: 'ACCEPT_INVITE_REQUIRED' });
    });
  });

  describe('POST /auth/resend-otp', () => {
    it('email không tồn tại → 200 thông báo chung, không gửi email', async () => {
      const email = randomEmail();

      const res = await http()
        .post('/auth/resend-otp')
        .send({ email })
        .expect(200);

      expect(res.body).toEqual({ message: expect.any(String) });
      expect(mailer.lastTo(email)).toBeUndefined();
    });

    it('trong cooldown → 429 OTP_RESEND_TOO_SOON; hết cooldown → OTP mới dùng được', async () => {
      const email = randomEmail();
      await register(email).expect(201);
      const firstOtp = otpFor(email);

      const tooSoon = await http()
        .post('/auth/resend-otp')
        .send({ email })
        .expect(429);
      expect(tooSoon.body).toMatchObject({ code: 'OTP_RESEND_TOO_SOON' });

      clock.advance(60 * SECOND);
      const ok = await http()
        .post('/auth/resend-otp')
        .send({ email })
        .expect(200);
      expect(ok.body).toEqual({ message: expect.any(String) });
      const secondOtp = otpFor(email);
      if (secondOtp !== firstOtp) {
        await http()
          .post('/auth/verify-email')
          .send({ email, otp: firstOtp })
          .expect(422);
      }
      await http()
        .post('/auth/verify-email')
        .send({ email, otp: secondOtp })
        .expect(200);
    });

    it('user đã ACTIVE → 200 thông báo chung, không gửi email mới', async () => {
      const { email } = await activeCustomer();
      const sentBefore = mailer.sent.length;

      await http().post('/auth/resend-otp').send({ email }).expect(200);

      expect(mailer.sent.length).toBe(sentBefore);
    });
  });

  describe('POST /auth/login – lỗi', () => {
    it('sai mật khẩu và email không tồn tại → cùng 401 INVALID_CREDENTIALS', async () => {
      const { email } = await activeCustomer();

      const wrongPassword = await login(email, 'saimatkhau1').expect(401);
      const unknownEmail = await login(randomEmail()).expect(401);

      expect(wrongPassword.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });

    it.each([
      ['LOCKED', 'ACCOUNT_LOCKED'],
      ['INACTIVE', 'ACCOUNT_INACTIVE'],
    ])('user %s → 403 %s', async (status, code) => {
      const { email } = await activeCustomer();
      await dataSource.query(`UPDATE users SET status = $1 WHERE email = $2`, [
        status,
        email,
      ]);

      const res = await login(email).expect(403);

      expect(res.body).toMatchObject({ code });
    });
  });

  describe('JwtAuthGuard + RolesGuard', () => {
    it('không có token → 401 UNAUTHENTICATED', async () => {
      const res = await http().get('/auth/me').expect(401);

      expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('token sai chữ ký / rác → 401 INVALID_TOKEN', async () => {
      const { token } = await activeCustomer();
      const [header, payload] = token.split('.');

      const tampered = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${header}.${payload}.chu-ky-sai`)
        .expect(401);
      const garbage = await http()
        .get('/auth/me')
        .set('Authorization', 'Bearer khong-phai-jwt')
        .expect(401);

      expect(tampered.body).toMatchObject({ code: 'INVALID_TOKEN' });
      expect(garbage.body).toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('user bị khóa sau khi đăng nhập → token cũ bị từ chối 401 ACCOUNT_LOCKED', async () => {
      const { email, token } = await activeCustomer();
      await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await dataSource.query(
        `UPDATE users SET status = 'LOCKED' WHERE email = $1`,
        [email],
      );

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    it('@Roles(ADMIN): customer → 403 INSUFFICIENT_ROLE', async () => {
      const { token } = await activeCustomer();

      const res = await http()
        .get('/__test__/auth/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    });

    it('@Roles(ADMIN): admin → 200, @CurrentUser có id + role', async () => {
      const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);
      const admin = await insertStaffLikeUser(
        ROLE_IDS.ADMIN,
        'ACTIVE',
        await hasher.hash(PASSWORD),
      );
      const token = (
        (await login(admin.email).expect(200)).body as { accessToken: string }
      ).accessToken;

      const res = await http()
        .get('/__test__/auth/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ id: admin.id, role: 'ADMIN' });
    });

    it('/health vẫn công khai', async () => {
      await http().get('/health').expect(200);
    });
  });

  describe('GET /auth/me – kèm profile', () => {
    it('designer → profile DESIGNER', async () => {
      const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);
      const designer = await insertStaffLikeUser(
        ROLE_IDS.DESIGNER,
        'ACTIVE',
        await hasher.hash(PASSWORD),
      );
      const employeeCode = `E2E${randomUUID().slice(0, 8)}`;
      await dataSource.query(
        `INSERT INTO designer_profiles (user_id, employee_code, title) VALUES ($1, $2, 'KTS')`,
        [designer.id, employeeCode],
      );
      const token = (
        (await login(designer.email).expect(200)).body as {
          accessToken: string;
        }
      ).accessToken;

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: designer.id,
        role: 'DESIGNER',
        profile: {
          type: 'DESIGNER',
          employeeCode,
          title: 'KTS',
          isAvailable: true,
        },
      });
    });
  });
});

describe('Auth rate limit (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createApp({ throttleLimit: 2 }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('vượt giới hạn /auth/login → 429', async () => {
    const send = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: randomEmail(), password: PASSWORD });

    await send().expect(401);
    await send().expect(401);
    const res = await send().expect(429);

    expect(res.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('/auth/me không bị giới hạn bởi throttler', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    }
  });
});
