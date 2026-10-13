// Chạy: `npm run seed` (trên bản build trong dist/). Chạy lại nhiều lần không tạo trùng.
import { DataSource } from 'typeorm';
import { validateEnv } from '../../config/env.validation.js';
import { BcryptPasswordHasher } from '../../infrastructure/bcrypt-password-hasher.js';
import {
  buildTypeOrmOptions,
  ENTITIES_GLOB,
} from '../postgres/typeorm-options.js';
import { seedDatabase } from './seed.js';

try {
  process.loadEnvFile();
} catch {
  // Không có file .env: dùng biến môi trường sẵn có của process.
}

const env = validateEnv(process.env);
const isProduction = env.NODE_ENV === 'production';
const dataSource = new DataSource({
  ...buildTypeOrmOptions(env),
  entities: [ENTITIES_GLOB],
});

await dataSource.initialize();
try {
  const result = await seedDatabase(
    dataSource,
    {
      adminEmail: env.SEED_ADMIN_EMAIL,
      adminPassword: env.SEED_ADMIN_PASSWORD,
      demoAccounts: isProduction
        ? null
        : {
            STAFF: {
              email: env.SEED_STAFF_EMAIL,
              password: env.SEED_STAFF_PASSWORD,
            },
            DESIGNER: {
              email: env.SEED_DESIGNER_EMAIL,
              password: env.SEED_DESIGNER_PASSWORD,
            },
            SUPPLIER: {
              email: env.SEED_SUPPLIER_EMAIL,
              password: env.SEED_SUPPLIER_PASSWORD,
            },
            CUSTOMER: {
              email: env.SEED_CUSTOMER_EMAIL,
              password: env.SEED_CUSTOMER_PASSWORD,
            },
          },
    },
    new BcryptPasswordHasher(),
  );
  console.log('[seed] 5 roles: OK');
  console.log(
    `[seed] Danh mục: +${result.catalog.stylesCreated} phong cách, +${result.catalog.categoriesCreated} danh mục sản phẩm`,
  );
  console.log(
    result.adminCreated
      ? `[seed] Đã tạo Admin ${env.SEED_ADMIN_EMAIL}`
      : `[seed] Admin ${env.SEED_ADMIN_EMAIL} đã tồn tại, bỏ qua`,
  );
  if (isProduction) {
    console.log('[seed] NODE_ENV=production: bỏ qua tài khoản demo');
  }
  for (const demo of result.demoUsers) {
    console.log(
      demo.created
        ? `[seed] Đã tạo ${demo.role} ${demo.email}`
        : `[seed] ${demo.role} ${demo.email} đã tồn tại, bỏ qua`,
    );
  }
} finally {
  await dataSource.destroy();
}
