import { validateEnv } from '../env.validation.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'user',
  POSTGRES_PASSWORD: 'pass',
  POSTGRES_DB: 'db',
  MONGO_URI: 'mongodb://localhost:27017/db',
  JWT_SECRET: 'x'.repeat(32),
  JWT_EXPIRES_IN: '1d',
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'Admin@123',
  FRONTEND_URL: 'http://localhost:3001',
};

const smtpEnv = {
  ...validEnv,
  MAIL_DRIVER: 'smtp',
  MAIL_HOST: 'smtp.gmail.com',
  MAIL_PORT: '465',
  MAIL_SECURE: 'true',
  MAIL_USER: 'user@gmail.com',
  MAIL_PASSWORD: 'app-password',
  MAIL_FROM: 'FA26SE095 <user@gmail.com>',
};

describe('validateEnv', () => {
  it('chuyển port sang number khi hợp lệ', () => {
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.POSTGRES_PORT).toBe(5432);
  });

  it('báo lỗi nêu tên biến bị thiếu', () => {
    const { POSTGRES_HOST: _host, MONGO_URI: _uri, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/POSTGRES_HOST[\s\S]*MONGO_URI/);
  });

  it('báo lỗi khi JWT_SECRET quá ngắn', () => {
    expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('báo lỗi khi SEED_ADMIN_EMAIL sai định dạng hoặc mật khẩu seed quá ngắn', () => {
    expect(() =>
      validateEnv({ ...validEnv, SEED_ADMIN_EMAIL: 'not-an-email' }),
    ).toThrow(/SEED_ADMIN_EMAIL/);
    expect(() =>
      validateEnv({ ...validEnv, SEED_ADMIN_PASSWORD: '1234567' }),
    ).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  it('báo lỗi khi thiếu hoặc sai FRONTEND_URL', () => {
    const { FRONTEND_URL: _url, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/FRONTEND_URL/);
    expect(() =>
      validateEnv({ ...validEnv, FRONTEND_URL: 'localhost:3001' }),
    ).toThrow(/FRONTEND_URL/);
  });

  it('MAIL_DRIVER mặc định là log và không cần biến MAIL_* khác', () => {
    expect(validateEnv(validEnv).MAIL_DRIVER).toBe('log');
  });

  it('báo lỗi khi MAIL_DRIVER không hợp lệ', () => {
    expect(() => validateEnv({ ...validEnv, MAIL_DRIVER: 'sendgrid' })).toThrow(
      /MAIL_DRIVER/,
    );
  });

  it('MAIL_DRIVER=smtp đủ biến → hợp lệ, port và secure được chuyển kiểu', () => {
    const env = validateEnv(smtpEnv);
    expect(env.MAIL_DRIVER).toBe('smtp');
    expect(env.MAIL_PORT).toBe(465);
    expect(env.MAIL_SECURE).toBe(true);
    expect(validateEnv({ ...smtpEnv, MAIL_SECURE: 'false' }).MAIL_SECURE).toBe(
      false,
    );
  });

  it('OTP_* có giá trị mặc định 15 phút / 5 lần / 60 giây', () => {
    const env = validateEnv(validEnv);
    expect(env.OTP_TTL_MINUTES).toBe(15);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it('OTP_* được chuyển sang number, báo lỗi khi ≤ 0 hoặc không phải số nguyên', () => {
    const env = validateEnv({
      ...validEnv,
      OTP_TTL_MINUTES: '10',
      OTP_MAX_ATTEMPTS: '3',
      OTP_RESEND_COOLDOWN_SECONDS: '30',
    });
    expect(env.OTP_TTL_MINUTES).toBe(10);
    expect(env.OTP_MAX_ATTEMPTS).toBe(3);
    expect(env.OTP_RESEND_COOLDOWN_SECONDS).toBe(30);

    expect(() => validateEnv({ ...validEnv, OTP_TTL_MINUTES: '0' })).toThrow(
      /OTP_TTL_MINUTES/,
    );
    expect(() => validateEnv({ ...validEnv, OTP_MAX_ATTEMPTS: '-1' })).toThrow(
      /OTP_MAX_ATTEMPTS/,
    );
    expect(() =>
      validateEnv({ ...validEnv, OTP_RESEND_COOLDOWN_SECONDS: 'abc' }),
    ).toThrow(/OTP_RESEND_COOLDOWN_SECONDS/);
  });

  it('MAIL_DRIVER=smtp thiếu biến MAIL_* → báo lỗi nêu tên biến', () => {
    const { MAIL_HOST: _host, MAIL_PASSWORD: _pass, ...rest } = smtpEnv;
    expect(() => validateEnv(rest)).toThrow(/MAIL_HOST[\s\S]*MAIL_PASSWORD/);
    expect(() => validateEnv({ ...smtpEnv, MAIL_USER: '' })).toThrow(
      /MAIL_USER/,
    );
    expect(() => validateEnv({ ...smtpEnv, MAIL_SECURE: 'yes' })).toThrow(
      /MAIL_SECURE/,
    );
  });
});
