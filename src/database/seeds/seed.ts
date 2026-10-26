import type { DataSource, EntityManager } from 'typeorm';
import type { PasswordHasher } from '../../common/ports/password-hasher.js';
import type { CostCategory } from '../../modules/catalog/entities/product-category.entity.js';
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
  /** Danh mục sản phẩm dùng chung (24 danh mục chuẩn). */
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
 * Danh mục: luôn thêm 6 phong cách thiết kế và 24 danh mục sản phẩm dùng chung (DB_CONTEXT §4.6).
 * Đã có `code` thì bỏ qua, không ghi đè (danh mục chỉ điền cột đang trống).
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
      categoriesCreated: await insertProductCategories(manager),
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

/** 24 danh mục dùng chung (DB_CONTEXT §4.6), khớp 23 model minh họa `ph-*.glb`; `OTHER` không có model. */
const PRODUCT_CATEGORIES: ReadonlyArray<{
  code: string;
  name: string;
  costCategory: CostCategory;
}> = [
  { code: 'SOFA', name: 'Sofa', costCategory: 'FURNITURE' },
  { code: 'ARMCHAIR', name: 'Ghế bành', costCategory: 'FURNITURE' },
  { code: 'COFFEE_TABLE', name: 'Bàn trà', costCategory: 'FURNITURE' },
  { code: 'TV_CONSOLE', name: 'Kệ TV', costCategory: 'FURNITURE' },
  { code: 'BED', name: 'Giường', costCategory: 'FURNITURE' },
  { code: 'NIGHTSTAND', name: 'Tủ đầu giường', costCategory: 'FURNITURE' },
  { code: 'WARDROBE', name: 'Tủ áo', costCategory: 'FURNITURE' },
  { code: 'DRAWER', name: 'Tủ ngăn kéo', costCategory: 'FURNITURE' },
  { code: 'DESK', name: 'Bàn làm việc', costCategory: 'FURNITURE' },
  { code: 'DINING_TABLE', name: 'Bàn ăn', costCategory: 'FURNITURE' },
  { code: 'DINING_CHAIR', name: 'Ghế ăn', costCategory: 'FURNITURE' },
  { code: 'KITCHEN_BASE', name: 'Tủ bếp dưới', costCategory: 'FURNITURE' },
  { code: 'KITCHEN_WALL', name: 'Tủ bếp trên', costCategory: 'FURNITURE' },
  { code: 'KITCHEN_COUNTER', name: 'Mặt bếp', costCategory: 'FURNITURE' },
  { code: 'DOWNLIGHT', name: 'Đèn âm trần', costCategory: 'LIGHTING' },
  { code: 'PENDANT_LIGHT', name: 'Đèn thả', costCategory: 'LIGHTING' },
  { code: 'WALL_LIGHT', name: 'Đèn tường', costCategory: 'LIGHTING' },
  { code: 'PICTURE', name: 'Tranh', costCategory: 'DECOR' },
  { code: 'PLANT', name: 'Cây cảnh', costCategory: 'DECOR' },
  { code: 'BASIN', name: 'Lavabo', costCategory: 'FINISHING' },
  { code: 'SHOWER', name: 'Sen tắm', costCategory: 'FINISHING' },
  { code: 'TOILET', name: 'Bồn cầu', costCategory: 'FINISHING' },
  { code: 'TV', name: 'Tivi', costCategory: 'OTHER' },
  { code: 'OTHER', name: 'Khác', costCategory: 'OTHER' },
];

/** Đường dẫn tạm của model minh họa (đổi khi chốt kho file), vd `KITCHEN_BASE` → `ph-kitchen-base.glb`. */
function placeholderModelUrl(code: string): string | null {
  if (code === 'OTHER') return null;
  return `/models/placeholders/ph-${code.toLowerCase().replaceAll('_', '-')}.glb`;
}

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

/**
 * Thêm danh mục chuẩn chưa có (theo `code`). Đã có thì chỉ điền `cost_category` / `default_model_url` đang trống,
 * không ghi đè tên hay giá trị Admin đã sửa. Trả số danh mục mới tạo.
 */
async function insertProductCategories(
  manager: EntityManager,
): Promise<number> {
  const rows: { inserted: boolean }[] = await manager.query(
    `INSERT INTO product_categories (code, name, cost_category, default_model_url, is_active)
     SELECT code, name, cost_category, default_model_url, true
     FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[])
       AS t(code, name, cost_category, default_model_url)
     ON CONFLICT (code) DO UPDATE SET
       cost_category = COALESCE(product_categories.cost_category, EXCLUDED.cost_category),
       default_model_url = COALESCE(product_categories.default_model_url, EXCLUDED.default_model_url)
     RETURNING (xmax = 0) AS inserted`,
    [
      PRODUCT_CATEGORIES.map((c) => c.code),
      PRODUCT_CATEGORIES.map((c) => c.name),
      PRODUCT_CATEGORIES.map((c) => c.costCategory),
      PRODUCT_CATEGORIES.map((c) => placeholderModelUrl(c.code)),
    ],
  );
  return rows.filter((row) => row.inserted).length;
}
