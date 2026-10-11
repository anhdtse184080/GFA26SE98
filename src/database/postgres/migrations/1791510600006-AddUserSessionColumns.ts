import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Phiên đăng nhập (mỗi user tối đa 1 phiên) cho refresh token / logout phía server. */
export class AddUserSessionColumns1791510600006 implements MigrationInterface {
  name = 'AddUserSessionColumns1791510600006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD "session_id" uuid,
        ADD "refresh_token_hash" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "refresh_token_hash",
        DROP COLUMN "session_id"
    `);
  }
}
