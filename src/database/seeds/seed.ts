import { type DataSource, type EntityManager, In } from 'typeorm';
import type { PasswordHasher } from '../../common/ports/password-hasher.js';
import { ProductCategory } from '../../modules/catalog/entities/product-category.entity.js';
import { DesignStyle } from '../../modules/design-styles/entities/design-style.entity.js';
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

export interface CatalogSeedResult {
  /** Số bản ghi mới tạo (đã có thì bỏ qua). */
  stylesCreated: number;
  /** Danh mục mẫu của supplier demo (0 ở production). */
  categoriesCreated: number;
}

export interface SeedResult {
  adminCreated: boolean;
  demoUsers: DemoUserResult[];
  catalog: CatalogSeedResult;
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
 * Danh mục: luôn thêm 6 phong cách thiết kế; ngoài production thêm cây danh mục sản phẩm mẫu
 * cho supplier demo (danh mục riêng từng supplier). Đã có `code` thì bỏ qua, không ghi đè.
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
    const catalog: CatalogSeedResult = {
      stylesCreated: await insertDesignStyles(manager),
      categoriesCreated: 0,
    };

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
      return { adminCreated, demoUsers: [], catalog };
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
      if (demo.role === 'SUPPLIER') {
        const supplier = await manager.getRepository(SupplierProfile).findOne({
          where: { user: { email: demo.email } },
          select: { userId: true },
        });
        if (supplier) {
          catalog.categoriesCreated = await insertProductCategories(
            manager,
            supplier.userId,
          );
        }
      }
      demoUsers.push({
        role: demo.role,
        email: demo.email,
        created: userId !== null,
      });
    }

    return { adminCreated, demoUsers, catalog };
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

// ---------- Catalog ----------

const DESIGN_STYLES = [
  {
    code: 'MINIMALIST',
    name: 'Minimalist',
    description: 'Tối giản, ít đồ, màu trung tính, nhiều khoảng trống',
  },
  {
    code: 'JAPANDI',
    name: 'Japandi',
    description: 'Kết hợp tối giản Nhật Bản và Bắc Âu, gỗ sáng, đường nét mộc',
  },
  {
    code: 'SCANDINAVIAN',
    name: 'Scandinavian',
    description: 'Bắc Âu: sáng, ấm, gỗ tự nhiên, công năng cao',
  },
  {
    code: 'INDUSTRIAL',
    name: 'Industrial',
    description: 'Công nghiệp: kim loại, bê tông, gạch thô, tông tối',
  },
  {
    code: 'CONTEMPORARY',
    name: 'Contemporary',
    description: 'Đương đại: đường nét gọn, vật liệu hiện đại, tương phản',
  },
  {
    code: 'INDOCHINE',
    name: 'Indochine',
    description: 'Đông Dương: gỗ tối, gạch bông, mây tre, họa tiết Á Đông',
  },
] as const;

/** Danh mục gốc → danh mục con. */
const PRODUCT_CATEGORY_TREE: ReadonlyArray<{
  code: string;
  name: string;
  children: ReadonlyArray<{ code: string; name: string }>;
}> = [
  {
    code: 'FURNITURE',
    name: 'Nội thất',
    children: [
      { code: 'SOFA', name: 'Sofa' },
      { code: 'TABLE', name: 'Bàn' },
      { code: 'BED', name: 'Giường' },
      { code: 'CABINET', name: 'Tủ' },
    ],
  },
  { code: 'LIGHTING', name: 'Chiếu sáng', children: [] },
  { code: 'DECOR', name: 'Trang trí', children: [] },
  { code: 'APPLIANCE', name: 'Thiết bị', children: [] },
  { code: 'FINISH_MATERIAL', name: 'Vật liệu hoàn thiện', children: [] },
];

/** Thêm style chưa có (theo `code`), không ghi đè style đã sửa. Trả số style mới tạo. */
async function insertDesignStyles(manager: EntityManager): Promise<number> {
  const result = await manager
    .createQueryBuilder()
    .insert()
    .into(DesignStyle)
    .values(DESIGN_STYLES.map((s) => ({ ...s, isActive: true })))
    .orIgnore()
    .returning(['id'])
    .execute();
  return (result.raw as unknown[]).length;
}

/** Thêm danh mục mẫu cho supplier (bỏ qua `code` đã có trong catalog của supplier). Trả số danh mục mới tạo. */
async function insertProductCategories(
  manager: EntityManager,
  supplierId: string,
): Promise<number> {
  const repo = manager.getRepository(ProductCategory);
  const insert = async (
    values: Pick<
      ProductCategory,
      'supplierId' | 'code' | 'name' | 'parentId' | 'isActive'
    >[],
  ): Promise<number> => {
    const result = await repo
      .createQueryBuilder()
      .insert()
      .values(values)
      .orIgnore()
      .returning(['id'])
      .execute();
    return (result.raw as unknown[]).length;
  };

  let created = await insert(
    PRODUCT_CATEGORY_TREE.map((c) => ({
      supplierId,
      code: c.code,
      name: c.name,
      parentId: null,
      isActive: true,
    })),
  );
  const roots = await repo.find({
    where: {
      supplierId,
      code: In(PRODUCT_CATEGORY_TREE.map((c) => c.code)),
    },
  });
  const rootIdByCode = new Map(roots.map((r) => [r.code, r.id]));
  const children = PRODUCT_CATEGORY_TREE.flatMap((root) =>
    root.children.map((child) => ({
      supplierId,
      code: child.code,
      name: child.name,
      parentId: rootIdByCode.get(root.code) ?? null,
      isActive: true,
    })),
  );
  if (children.length > 0) created += await insert(children);
  return created;
}
