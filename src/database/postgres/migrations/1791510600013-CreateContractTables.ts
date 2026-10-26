import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hợp đồng & thanh toán theo đợt (DB_CONTEXT v6 §4.3, §4.4): contracts, payment_milestones, contract_signatures.
 * Thêm FK `design_versions.milestone_id → payment_milestones` (cột đã có từ migration 0011).
 * `payment_milestones(contract_id)`, `contract_signatures(contract_id)` dùng index của UQ (cột đầu).
 */
export class CreateContractTables1791510600013 implements MigrationInterface {
  name = 'CreateContractTables1791510600013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "contracts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "contract_no" character varying(30) NOT NULL,
        "total_design_fee" numeric(15,2) NOT NULL,
        "max_revisions_per_stage" smallint NOT NULL,
        "review_window_days" smallint NOT NULL,
        "unsigned_file_url" character varying(500),
        "unsigned_file_name" character varying(255),
        "unsigned_file_hash" character varying(64),
        "file_url" character varying(500),
        "file_name" character varying(255),
        "signed_date" date,
        "status" character varying(20) NOT NULL,
        "note" text,
        "created_by" uuid NOT NULL,
        "activated_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancel_reason" text,
        "esign_status" character varying(20) NOT NULL DEFAULT 'NOT_SENT',
        "esign_sent_at" TIMESTAMP WITH TIME ZONE,
        "esign_completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contracts" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contracts_project_id" UNIQUE ("project_id"),
        CONSTRAINT "uq_contracts_contract_no" UNIQUE ("contract_no"),
        CONSTRAINT "chk_contracts_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
        CONSTRAINT "chk_contracts_esign_status" CHECK ("esign_status" IN ('NOT_SENT', 'AWAITING_CUSTOMER', 'AWAITING_COMPANY', 'SIGNED')),
        CONSTRAINT "chk_contracts_total_design_fee" CHECK ("total_design_fee" > 0),
        CONSTRAINT "chk_contracts_max_revisions_per_stage" CHECK ("max_revisions_per_stage" >= 0),
        CONSTRAINT "chk_contracts_review_window_days" CHECK ("review_window_days" > 0),
        CONSTRAINT "fk_contracts_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_contracts_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_milestones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "contract_id" uuid NOT NULL,
        "seq_no" smallint NOT NULL,
        "name" character varying(150) NOT NULL,
        "stage_type" character varying(20) NOT NULL,
        "amount" numeric(15,2) NOT NULL,
        "due_trigger" character varying(30) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "approved_version_id" uuid,
        "review_deadline" TIMESTAMP WITH TIME ZONE,
        "auto_approved" boolean NOT NULL DEFAULT false,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "invoiced_at" TIMESTAMP WITH TIME ZONE,
        "due_date" date,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_payment_milestones" PRIMARY KEY ("id"),
        CONSTRAINT "uq_payment_milestones_contract_id_seq_no" UNIQUE ("contract_id", "seq_no"),
        CONSTRAINT "chk_payment_milestones_stage_type" CHECK ("stage_type" IN ('DEPOSIT', 'LAYOUT_2D', 'RENDER_3D', 'FINAL_PACKAGE')),
        CONSTRAINT "chk_payment_milestones_due_trigger" CHECK ("due_trigger" IN ('ON_CONTRACT_ACTIVE', 'ON_STAGE_APPROVED')),
        CONSTRAINT "chk_payment_milestones_status" CHECK ("status" IN ('PENDING', 'INVOICED', 'PAID', 'OVERDUE', 'CANCELLED')),
        CONSTRAINT "chk_payment_milestones_seq_no" CHECK ("seq_no" > 0),
        CONSTRAINT "chk_payment_milestones_amount" CHECK ("amount" > 0),
        CONSTRAINT "fk_payment_milestones_contract_id" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_payment_milestones_approved_version_id" FOREIGN KEY ("approved_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "contract_signatures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "contract_id" uuid NOT NULL,
        "signer_id" uuid NOT NULL,
        "signer_role" character varying(10) NOT NULL,
        "signer_name_snapshot" character varying(150) NOT NULL,
        "signer_email_snapshot" character varying(255) NOT NULL,
        "document_hash" character varying(64) NOT NULL,
        "ip_address" character varying(45),
        "user_agent" character varying(500),
        "signed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "pk_contract_signatures" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contract_signatures_contract_id_signer_role" UNIQUE ("contract_id", "signer_role"),
        CONSTRAINT "chk_contract_signatures_signer_role" CHECK ("signer_role" IN ('CUSTOMER', 'COMPANY')),
        CONSTRAINT "fk_contract_signatures_contract_id" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_contract_signatures_signer_id" FOREIGN KEY ("signer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_contract_signatures_signer_id" ON "contract_signatures" ("signer_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "design_versions" ADD CONSTRAINT "fk_design_versions_milestone_id" FOREIGN KEY ("milestone_id") REFERENCES "payment_milestones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "design_versions" DROP CONSTRAINT "fk_design_versions_milestone_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_contract_signatures_signer_id"`);
    await queryRunner.query(`DROP TABLE "contract_signatures"`);
    await queryRunner.query(`DROP TABLE "payment_milestones"`);
    await queryRunner.query(`DROP TABLE "contracts"`);
  }
}
