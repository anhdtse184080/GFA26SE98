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
});
