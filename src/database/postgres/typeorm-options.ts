import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import type { EnvironmentVariables } from '../../config/env.validation.js';

type PostgresEnv = Pick<
  EnvironmentVariables,
  | 'POSTGRES_HOST'
  | 'POSTGRES_PORT'
  | 'POSTGRES_USER'
  | 'POSTGRES_PASSWORD'
  | 'POSTGRES_DB'
>;

/**
 * Mọi entity trong bản build (dist/). Dùng cho script chạy ngoài Nest (TypeORM CLI, seed),
 * để thêm entity/quan hệ mới không phải sửa danh sách tay. Nest dùng `autoLoadEntities`.
 */
export const ENTITIES_GLOB = join(
  import.meta.dirname,
  '..',
  '..',
  '**',
  '*.entity.js',
);

/** Cấu hình TypeORM dùng chung cho Nest (TypeOrmModule) và TypeORM CLI (data-source.ts). */
export function buildTypeOrmOptions(env: PostgresEnv) {
  return {
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    synchronize: false,
    // PK UUID mặc định gen_random_uuid() (có sẵn từ PostgreSQL 13, không cần cài extension).
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    namingStrategy: new SnakeNamingStrategy(),
    // Mặc định TypeORM bỏ qua điều kiện null/undefined trong `where` → findOne trả bản ghi bất kỳ.
    // Cần điều kiện NULL thật thì dùng IsNull().
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
    migrations: [join(import.meta.dirname, 'migrations', '*.js')],
    migrationsTableName: 'migrations',
  } satisfies DataSourceOptions;
}
