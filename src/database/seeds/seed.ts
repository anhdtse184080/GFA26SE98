import type { DataSource, EntityManager } from 'typeorm';
import type { PasswordHasher } from '../../common/ports/password-hasher.js';
import { DesignerProfile } from '../../modules/users/entities/designer-profile.entity.js';
import { Role } from '../../modules/users/entities/role.entity.js';
import { SupplierProfile } from '../../modules/users/entities/supplier-profile.entity.js';
import { User } from '../../modules/users/entities/user.entity.js';
import {
  ROLE_DISPLAY_NAMES,
  ROLE_IDS,
  type RoleCode,
} from '../../common/auth/role-code.js';

export type DemoRole = Exclude<RoleCode, 'ADMIN'>;

export interface SeedCredentials {
  email: string;
  password: string;
}

export interface SeedOptions {
  adminEmail: string;
  adminPassword: string;
  /** `null` = không seed tài khoản demo (production). */
  demoAccounts: Record<DemoRole, SeedCredentials> | null;
}

export interface DemoUserResult {
  role: RoleCode;
  email: string;
  created: boolean;
}

export interface SeedResult {
  adminCreated: boolean;
  demoUsers: DemoUserResult[];
}

interface DemoUser {
  role: DemoRole;
  fullName: string;
  phone: string;
  /** Staff/Designer/Supplier do Admin tạo; Customer giống tự đăng ký (`created_by = null`). */
  createdByAdmin: boolean;
}

const DEMO_USERS: readonly DemoUser[] = [
  {
    role: 'STAFF',
    fullName: 'Demo Staff',
    phone: '0900000001',
    createdByAdmin: true,
  },
  {
    role: 'DESIGNER',
    fullName: 'Demo Designer',
    phone: '0900000002',
    createdByAdmin: true,
  },
  {
    role: 'SUPPLIER',
    fullName: 'Demo Supplier',
    phone: '0900000003',
    createdByAdmin: true,
  },
  {
    role: 'CUSTOMER',
    fullName: 'Demo Customer',
    phone: '0900000004',
    createdByAdmin: false,
  },
];

/**
 * Seed idempotent: upsert 5 roles; tạo Admin đầu tiên nếu email chưa tồn tại
 * (đã tồn tại thì giữ nguyên, không ghi đè mật khẩu). Ngoài production còn tạo
 * 1 tài khoản demo ACTIVE (có mật khẩu, đăng nhập được ngay) cho mỗi role
 * STAFF/DESIGNER/SUPPLIER/CUSTOMER, kèm profile — ngoại lệ có chủ đích so với DB_CONTEXT §6.1.
 *
 * Ngoại lệ có chủ đích của ARCHITECTURE §4–5: script CLI chạy ngoài Nest DI nên dùng
 * thẳng `DataSource`/QueryBuilder thay vì repository + UnitOfWork. Code trong app không làm vậy.
 */
export async function seedDatabase(
  dataSource: DataSource,
  options: SeedOptions,
  hasher: PasswordHasher,
): Promise<SeedResult> {
  const users = dataSource.getRepository(User);
  const email = options.adminEmail.trim().toLowerCase();
  // Hash ngoài transaction (tốn CPU, không cần giữ kết nối); email đã tồn tại thì không hash.
  const passwordHash = (await users.existsBy({ email }))
    ? null
    : await hasher.hash(options.adminPassword);

  const demoAccounts = options.demoAccounts;
  const demos = demoAccounts
    ? await Promise.all(
        DEMO_USERS.map(async (demo) => {
          const credentials = demoAccounts[demo.role];
          const demoEmail = credentials.email.trim().toLowerCase();
          const hash = (await users.existsBy({ email: demoEmail }))
            ? null
            : await hasher.hash(credentials.password);
          return { ...demo, email: demoEmail, passwordHash: hash };
        }),
      )
    : [];

  return dataSource.transaction(async (manager) => {
    const roles = (Object.keys(ROLE_IDS) as RoleCode[]).map((code) => ({
      id: ROLE_IDS[code],
      code,
      name: ROLE_DISPLAY_NAMES[code],
    }));
    await manager.getRepository(Role).upsert(roles, ['id']);

    const adminCreated =
      passwordHash !== null &&
      (await insertUser(manager, {
        roleId: ROLE_IDS.ADMIN,
        email,
        passwordHash,
        fullName: 'System Administrator',
        phone: null,
        createdById: null,
      })) !== null;

    if (demos.length === 0) {
      return { adminCreated, demoUsers: [] };
    }
    const admin = await manager
      .getRepository(User)
      .findOneOrFail({ where: { email }, select: { id: true } });

    const demoUsers: DemoUserResult[] = [];
    for (const demo of demos) {
      const userId =
        demo.passwordHash === null
          ? null
          : await insertUser(manager, {
              roleId: ROLE_IDS[demo.role],
              email: demo.email,
              passwordHash: demo.passwordHash,
              fullName: demo.fullName,
              phone: demo.phone,
              createdById: demo.createdByAdmin ? admin.id : null,
            });
      if (userId !== null) {
        await insertProfile(manager, demo.role, userId);
      }
      demoUsers.push({
        role: demo.role,
        email: demo.email,
        created: userId !== null,
      });
    }
    return { adminCreated, demoUsers };
  });
}

interface NewActiveUser {
  roleId: number;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  createdById: string | null;
}

/** Tạo user ACTIVE; email đã tồn tại thì bỏ qua và trả `null`. */
async function insertUser(
  manager: EntityManager,
  user: NewActiveUser,
): Promise<string | null> {
  const result = await manager
    .createQueryBuilder()
    .insert()
    .into(User)
    .values({ ...user, status: 'ACTIVE', activatedAt: new Date() })
    .orIgnore()
    .returning(['id'])
    .execute();
  const rows = result.raw as { id: string }[];
  return rows.length > 0 ? rows[0].id : null;
}

async function insertProfile(
  manager: EntityManager,
  role: RoleCode,
  userId: string,
): Promise<void> {
  if (role === 'DESIGNER') {
    await manager.getRepository(DesignerProfile).insert({
      userId,
      employeeCode: 'DS0001',
      title: 'KTS',
      specialization: 'Thiết kế nội thất căn hộ chung cư',
      yearsOfExperience: 3,
      bio: 'Tài khoản designer demo',
      isAvailable: true,
    });
  } else if (role === 'SUPPLIER') {
    await manager.getRepository(SupplierProfile).insert({
      userId,
      companyName: 'Công ty Nội thất Demo',
      taxCode: '0100000001',
      businessAddress: '1 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
      contactName: 'Demo Supplier',
      contactPhone: '0900000003',
      website: null,
      partnershipStatus: 'ACTIVE',
      partnerSince: null,
    });
  }
}
