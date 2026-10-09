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
    namingStrategy: new SnakeNamingStrategy(),
    migrations: [join(import.meta.dirname, 'migrations', '*.js')],
    migrationsTableName: 'migrations',
  } satisfies DataSourceOptions;
}
