import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { validateEnv } from './../src/config/env.validation.js';
import { buildTypeOrmOptions } from './../src/database/postgres/typeorm-options.js';
import { seedDatabase } from './../src/database/seeds/seed.js';
import { BcryptPasswordHasher } from './../src/infrastructure/bcrypt-password-hasher.js';

/** Mọi entity trong src (test chạy trên source .ts nên không dùng ENTITIES_GLOB của dist). */
const ENTITIES = Object.values(
  import.meta.glob<Record<string, unknown>>('../src/**/*.entity.ts', {
    eager: true,
  }),
).flatMap((mod) => Object.values(mod).filter((v) => typeof v === 'function'));

// Cần chạy `npm run db:up` và `npm run migration:run` trước.
describe('Account schema & seed (e2e)', () => {
  let dataSource: DataSource;
  const env = (() => {
    try {
      process.loadEnvFile();
    } catch {
      // dùng biến môi trường sẵn có
    }
    return validateEnv(process.env);
  })();

  beforeAll(async () => {
    dataSource = new DataSource({
      ...buildTypeOrmOptions(env),
      entities: ENTITIES as Function[],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /** Chạy SQL trong transaction rồi rollback, trả mã lỗi Postgres (nếu có). */
  async function pgErrorCode(
    sql: string,
    params: unknown[] = [],
  ): Promise<string | null> {
    const qr = dataSource.createQueryRunner();
    await qr.startTransaction();
    try {
      await qr.query(sql, params);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(QueryFailedError);
      return (error as QueryFailedError & { driverError: { code: string } })
        .driverError.code;
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  }

  describe('seed', () => {
    const seedOptions = {
      adminEmail: env.SEED_ADMIN_EMAIL,
      adminPassword: env.SEED_ADMIN_PASSWORD,
    };
    const hasher = new BcryptPasswordHasher(4);

    it('chạy hai lần: đúng 5 roles và 1 Admin ACTIVE, không ghi đè mật khẩu', async () => {
      await seedDatabase(dataSource, seedOptions, hasher);
      const [before] = await dataSource.query(
        `SELECT password_hash FROM users WHERE email = $1`,
        [env.SEED_ADMIN_EMAIL.toLowerCase()],
      );

      const second = await seedDatabase(dataSource, seedOptions, hasher);

      expect(second.adminCreated).toBe(false);
      expect(
        await dataSource.query(`SELECT id, code FROM roles ORDER BY id`),
      ).toEqual([
        { id: 1, code: 'ADMIN' },
        { id: 2, code: 'STAFF' },
        { id: 3, code: 'DESIGNER' },
        { id: 4, code: 'CUSTOMER' },
        { id: 5, code: 'SUPPLIER' },
      ]);
      const admins = await dataSource.query(
        `SELECT u.status, u.created_by, u.password_hash, r.code AS role
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.email = $1`,
        [env.SEED_ADMIN_EMAIL.toLowerCase()],
      );
      expect(admins).toHaveLength(1);
      expect(admins[0]).toMatchObject({
        status: 'ACTIVE',
        created_by: null,
        role: 'ADMIN',
        password_hash: before.password_hash,
      });
    });
  });

  describe('ràng buộc', () => {
    const insertUser = `INSERT INTO users (role_id, email, full_name, status) VALUES ($1, $2, 'Test', $3)`;
    const email = () => `e2e-${randomUUID()}@example.com`;

    it('user hợp lệ được chèn, id tự sinh bằng gen_random_uuid()', async () => {
      const code = await pgErrorCode(insertUser, [4, email(), 'INVITED']);
      expect(code).toBeNull();
    });

    it('status ngoài enum → vi phạm CHECK (23514)', async () => {
      expect(await pgErrorCode(insertUser, [4, email(), 'DELETED'])).toBe(
        '23514',
      );
    });

    it('email viết hoa → vi phạm CHECK chữ thường (23514)', async () => {
      expect(
        await pgErrorCode(insertUser, [4, email().toUpperCase(), 'INVITED']),
      ).toBe('23514');
    });

    it('trùng email → vi phạm UQ (23505)', async () => {
      expect(
        await pgErrorCode(
          `INSERT INTO users (role_id, email, full_name, status)
           VALUES ($1, $2, 'A', 'INVITED'), ($1, $2, 'B', 'INVITED')`,
          [4, email()],
        ),
      ).toBe('23505');
    });

    it('role_id không tồn tại → vi phạm FK (23503)', async () => {
      expect(await pgErrorCode(insertUser, [99, email(), 'INVITED'])).toBe(
        '23503',
      );
    });

    it('otp purpose ngoài enum → vi phạm CHECK (23514)', async () => {
      const [admin] = await dataSource.query(
        `SELECT id FROM users WHERE email = $1`,
        [env.SEED_ADMIN_EMAIL.toLowerCase()],
      );
      expect(
        await pgErrorCode(
          `INSERT INTO otp_verifications (user_id, purpose, channel, code_hash, expires_at)
           VALUES ($1, 'CONTRACT_SIGNING', 'EMAIL', 'x', now())`,
          [admin.id],
        ),
      ).toBe('23514');
    });

    it('có index cho users.email và otp_verifications(user_id, purpose)', async () => {
      const rows: { indexname: string; indexdef: string }[] =
        await dataSource.query(
          `SELECT indexname, indexdef FROM pg_indexes
            WHERE tablename IN ('users', 'otp_verifications')`,
        );
      const defs = Object.fromEntries(
        rows.map((r) => [r.indexname, r.indexdef]),
      );
      expect(defs['uq_users_email']).toMatch(/UNIQUE INDEX .* \(email\)/);
      expect(defs['idx_otp_verifications_user_id_purpose']).toMatch(
        /\(user_id, purpose\)/,
      );
    });
  });
});
