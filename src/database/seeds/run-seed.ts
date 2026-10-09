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
    },
    new BcryptPasswordHasher(),
  );
  console.log('[seed] 5 roles: OK');
  console.log(
    result.adminCreated
      ? `[seed] Đã tạo Admin ${env.SEED_ADMIN_EMAIL}`
      : `[seed] Admin ${env.SEED_ADMIN_EMAIL} đã tồn tại, bỏ qua`,
  );
} finally {
  await dataSource.destroy();
}
