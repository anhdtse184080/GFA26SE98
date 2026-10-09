// DataSource cho TypeORM CLI (migration:generate/run/revert). CLI chạy trên bản build trong dist/.
import { DataSource } from 'typeorm';
import { validateEnv } from '../../config/env.validation.js';
import { buildTypeOrmOptions, ENTITIES_GLOB } from './typeorm-options.js';

try {
  process.loadEnvFile();
} catch {
  // Không có file .env: dùng biến môi trường sẵn có của process.
}

const env = validateEnv(process.env);

export default new DataSource({
  ...buildTypeOrmOptions(env),
  entities: [ENTITIES_GLOB],
});
