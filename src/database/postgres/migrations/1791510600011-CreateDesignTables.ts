import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thiết kế & phiên bản (DB_CONTEXT v6 §4.5): design_versions, design_elements, design_assets, revision_requests, comments.
 * `design_versions.milestone_id`, `source_generation_id`: cột UUID, FK thêm sau khi có `payment_milestones`, `ai_generations`.
 * `design_versions(project_id)`, `design_elements(design_version_id)` dùng index của UQ (cột đầu), không tạo index riêng.
 */
export class CreateDesignTables1791510600011 implements MigrationInterface {
  name = 'CreateDesignTables1791510600011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "design_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "milestone_id" uuid,
        "parent_version_id" uuid,
        "version_type" character varying(20) NOT NULL,
        "version_no" integer NOT NULL,
        "revision_type" character varying(10),
        "source_type" character varying(10) NOT NULL,
        "scene_json" jsonb,
        "title" character varying(255) NOT NULL,
        "description" text,
        "status" character varying(30) NOT NULL,
        "source_generation_id" uuid,
        "created_by" uuid NOT NULL,
        "submitted_at" TIMESTAMP WITH TIME ZONE,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_design_versions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_design_versions_project_id_version_type_version_no" UNIQUE ("project_id", "version_type", "version_no"),
        CONSTRAINT "chk_design_versions_version_type" CHECK ("version_type" IN ('CONCEPT', 'LAYOUT_2D', 'RENDER_3D')),
        CONSTRAINT "chk_design_versions_revision_type" CHECK ("revision_type" IN ('MINOR', 'MAJOR')),
        CONSTRAINT "chk_design_versions_source_type" CHECK ("source_type" IN ('UPLOAD', 'EDIT')),
        CONSTRAINT "chk_design_versions_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'REVISION_REQUESTED', 'APPROVED', 'SUPERSEDED')),
        CONSTRAINT "chk_design_versions_version_no" CHECK ("version_no" > 0),
        CONSTRAINT "chk_design_versions_parent_version_id" CHECK ("parent_version_id" <> "id"),
        CONSTRAINT "fk_design_versions_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_design_versions_parent_version_id" FOREIGN KEY ("parent_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_design_versions_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "design_elements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "design_version_id" uuid NOT NULL,
        "room_id" uuid,
        "category_id" uuid,
        "name" character varying(150) NOT NULL,
        "element_type" character varying(20) NOT NULL,
        "position" jsonb,
        "width_mm" integer,
        "depth_mm" integer,
        "height_mm" integer,
        "color_code" character varying(20),
        "note" text,
        "dxf_handle" character varying(16),
        "block_name" character varying(100) NOT NULL,
        "overrides" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_design_elements" PRIMARY KEY ("id"),
        CONSTRAINT "uq_design_elements_design_version_id_dxf_handle" UNIQUE ("design_version_id", "dxf_handle"),
        CONSTRAINT "chk_design_elements_element_type" CHECK ("element_type" IN ('FURNITURE', 'LIGHTING', 'DECOR', 'APPLIANCE', 'FINISH_MATERIAL', 'OTHER')),
        CONSTRAINT "chk_design_elements_width_mm" CHECK ("width_mm" > 0),
        CONSTRAINT "chk_design_elements_depth_mm" CHECK ("depth_mm" > 0),
        CONSTRAINT "chk_design_elements_height_mm" CHECK ("height_mm" > 0),
        CONSTRAINT "fk_design_elements_design_version_id" FOREIGN KEY ("design_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_design_elements_room_id" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_design_elements_category_id" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "design_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "design_version_id" uuid,
        "asset_type" character varying(30) NOT NULL,
        "file_url" character varying(500) NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "uploaded_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_design_assets" PRIMARY KEY ("id"),
        CONSTRAINT "chk_design_assets_asset_type" CHECK ("asset_type" IN ('INPUT_FLOOR_PLAN', 'INPUT_PHOTO', 'INPUT_VIDEO', 'DRAWING_2D', 'MODEL_3D', 'RENDER_IMAGE', 'AI_VISUALIZATION', 'DOCUMENT')),
        CONSTRAINT "chk_design_assets_size_bytes" CHECK ("size_bytes" >= 0),
        CONSTRAINT "fk_design_assets_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_design_assets_design_version_id" FOREIGN KEY ("design_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_design_assets_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_design_assets_project_id" ON "design_assets" ("project_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_design_assets_design_version_id" ON "design_assets" ("design_version_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "revision_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "design_version_id" uuid NOT NULL,
        "requested_by" uuid NOT NULL,
        "content" text NOT NULL,
        "status" character varying(20) NOT NULL,
        "resolved_in_version_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_revision_requests" PRIMARY KEY ("id"),
        CONSTRAINT "chk_revision_requests_status" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
        CONSTRAINT "fk_revision_requests_design_version_id" FOREIGN KEY ("design_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_revision_requests_requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_revision_requests_resolved_in_version_id" FOREIGN KEY ("resolved_in_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_revision_requests_design_version_id" ON "revision_requests" ("design_version_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "design_version_id" uuid NOT NULL,
        "design_element_id" uuid,
        "parent_comment_id" uuid,
        "author_id" uuid NOT NULL,
        "content" text NOT NULL,
        "pin_position" jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'OPEN',
        "addressed_in_version_id" uuid,
        "proposed_product_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_comments" PRIMARY KEY ("id"),
        CONSTRAINT "chk_comments_status" CHECK ("status" IN ('OPEN', 'ADDRESSED', 'RESOLVED')),
        CONSTRAINT "chk_comments_parent_comment_id" CHECK ("parent_comment_id" <> "id"),
        CONSTRAINT "fk_comments_design_version_id" FOREIGN KEY ("design_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_comments_design_element_id" FOREIGN KEY ("design_element_id") REFERENCES "design_elements"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_comments_parent_comment_id" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_comments_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_comments_addressed_in_version_id" FOREIGN KEY ("addressed_in_version_id") REFERENCES "design_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_comments_proposed_product_id" FOREIGN KEY ("proposed_product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_comments_design_version_id" ON "comments" ("design_version_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_comments_parent_comment_id" ON "comments" ("parent_comment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_comments_design_element_id" ON "comments" ("design_element_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_comments_design_element_id"`);
    await queryRunner.query(`DROP INDEX "idx_comments_parent_comment_id"`);
    await queryRunner.query(`DROP INDEX "idx_comments_design_version_id"`);
    await queryRunner.query(`DROP TABLE "comments"`);
    await queryRunner.query(
      `DROP INDEX "idx_revision_requests_design_version_id"`,
    );
    await queryRunner.query(`DROP TABLE "revision_requests"`);
    await queryRunner.query(`DROP INDEX "idx_design_assets_design_version_id"`);
    await queryRunner.query(`DROP INDEX "idx_design_assets_project_id"`);
    await queryRunner.query(`DROP TABLE "design_assets"`);
    await queryRunner.query(`DROP TABLE "design_elements"`);
    await queryRunner.query(`DROP TABLE "design_versions"`);
  }
}
