import type { DataSource } from 'typeorm';
import type { PasswordHasher } from '../../common/ports/password-hasher.js';
import { Role } from '../../modules/users/entities/role.entity.js';
import { User } from '../../modules/users/entities/user.entity.js';
import {
  ROLE_DISPLAY_NAMES,
  ROLE_IDS,
  type RoleCode,
} from '../../modules/users/role-code.enum.js';

export interface SeedOptions {
  adminEmail: string;
  adminPassword: string;
}

export interface SeedResult {
  adminCreated: boolean;
}

/**
 * Seed idempotent: upsert 5 roles; tạo Admin đầu tiên nếu email chưa tồn tại
 * (đã tồn tại thì giữ nguyên, không ghi đè mật khẩu).
 *
 * Ngoại lệ có chủ đích của ARCHITECTURE §4–5: script CLI chạy ngoài Nest DI nên dùng
 * thẳng `DataSource`/QueryBuilder thay vì repository + UnitOfWork. Code trong app không làm vậy.
 */
export async function seedDatabase(
  dataSource: DataSource,
  options: SeedOptions,
  hasher: PasswordHasher,
): Promise<SeedResult> {
  const email = options.adminEmail.trim().toLowerCase();
  const existing = await dataSource.getRepository(User).existsBy({ email });
  // Hash ngoài transaction (tốn CPU, không cần giữ kết nối).
  const passwordHash = existing
    ? null
    : await hasher.hash(options.adminPassword);

  return dataSource.transaction(async (manager) => {
    const roles = (Object.keys(ROLE_IDS) as RoleCode[]).map((code) => ({
      id: ROLE_IDS[code],
      code,
      name: ROLE_DISPLAY_NAMES[code],
    }));
    await manager.getRepository(Role).upsert(roles, ['id']);

    if (passwordHash === null) {
      return { adminCreated: false };
    }
    const now = new Date();
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        roleId: ROLE_IDS.ADMIN,
        email,
        passwordHash,
        fullName: 'System Administrator',
        status: 'ACTIVE',
        createdById: null,
        activatedAt: now,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    return { adminCreated: result.raw.length > 0 };
  });
}
