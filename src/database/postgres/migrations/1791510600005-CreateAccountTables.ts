import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhóm bảng tài khoản (DB_CONTEXT §4.1): roles, users, designer_profiles, supplier_profiles, otp_verifications.
 * Enum viết literal (không import từ code) để migration cũ không đổi khi enum trong code đổi.
 */
export class CreateAccountTables1791510600005 implements MigrationInterface {
  name = 'CreateAccountTables1791510600005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" smallint NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(100) NOT NULL,
        CONSTRAINT "pk_roles" PRIMARY KEY ("id"),
        CONSTRAINT "uq_roles_code" UNIQUE ("code"),
        CONSTRAINT "chk_roles_code" CHECK ("code" IN ('ADMIN', 'STAFF', 'DESIGNER', 'CUSTOMER', 'SUPPLIER'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "role_id" smallint NOT NULL,
        "email" character varying(255) NOT NULL,
        "password_hash" character varying(255),
        "full_name" character varying(150) NOT NULL,
        "phone" character varying(20),
        "status" character varying(20) NOT NULL,
        "created_by" uuid,
        "activated_at" TIMESTAMP WITH TIME ZONE,
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "chk_users_status" CHECK ("status" IN ('INVITED', 'ACTIVE', 'INACTIVE', 'LOCKED')),
        CONSTRAINT "chk_users_email_lowercase" CHECK ("email" = lower("email")),
        CONSTRAINT "fk_users_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_users_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_users_role_id" ON "users" ("role_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "designer_profiles" (
        "user_id" uuid NOT NULL,
        "employee_code" character varying(20) NOT NULL,
        "title" character varying(100),
        "specialization" character varying(255),
        "years_of_experience" smallint,
        "bio" text,
        "is_available" boolean NOT NULL DEFAULT true,
        "rating_avg" numeric(3,2) NOT NULL DEFAULT 0,
        "rating_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_designer_profiles" PRIMARY KEY ("user_id"),
        CONSTRAINT "uq_designer_profiles_employee_code" UNIQUE ("employee_code"),
        CONSTRAINT "chk_designer_profiles_years_of_experience" CHECK ("years_of_experience" >= 0),
        CONSTRAINT "chk_designer_profiles_rating_avg" CHECK ("rating_avg" BETWEEN 0 AND 5),
        CONSTRAINT "chk_designer_profiles_rating_count" CHECK ("rating_count" >= 0),
        CONSTRAINT "fk_designer_profiles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "supplier_profiles" (
        "user_id" uuid NOT NULL,
        "company_name" character varying(255) NOT NULL,
        "tax_code" character varying(20) NOT NULL,
        "business_address" character varying(500) NOT NULL,
        "contact_name" character varying(150),
        "contact_phone" character varying(20),
        "website" character varying(255),
        "partnership_status" character varying(20) NOT NULL,
        "partner_since" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_supplier_profiles" PRIMARY KEY ("user_id"),
        CONSTRAINT "uq_supplier_profiles_tax_code" UNIQUE ("tax_code"),
        CONSTRAINT "chk_supplier_profiles_partnership_status" CHECK ("partnership_status" IN ('ACTIVE', 'SUSPENDED', 'ENDED')),
        CONSTRAINT "fk_supplier_profiles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "otp_verifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "purpose" character varying(30) NOT NULL,
        "channel" character varying(10) NOT NULL,
        "code_hash" character varying(255) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "attempt_count" smallint NOT NULL DEFAULT 0,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_otp_verifications" PRIMARY KEY ("id"),
        CONSTRAINT "chk_otp_verifications_purpose" CHECK ("purpose" IN ('ACCOUNT_ACTIVATION', 'PASSWORD_RESET')),
        CONSTRAINT "chk_otp_verifications_channel" CHECK ("channel" IN ('EMAIL', 'SMS')),
        CONSTRAINT "chk_otp_verifications_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "fk_otp_verifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_otp_verifications_user_id_purpose" ON "otp_verifications" ("user_id", "purpose")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_otp_verifications_user_id_purpose"`,
    );
    await queryRunner.query(`DROP TABLE "otp_verifications"`);
    await queryRunner.query(`DROP TABLE "supplier_profiles"`);
    await queryRunner.query(`DROP TABLE "designer_profiles"`);
    await queryRunner.query(`DROP INDEX "idx_users_role_id"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
