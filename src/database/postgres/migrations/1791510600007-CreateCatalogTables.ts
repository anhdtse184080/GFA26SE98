import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Danh mục (DB_CONTEXT §4.2, §4.6): design_styles, product_categories (riêng từng supplier). */
export class CreateCatalogTables1791510600007 implements MigrationInterface {
  name = 'CreateCatalogTables1791510600007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "design_styles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(50) NOT NULL,
        "name" character varying(100) NOT NULL,
        "description" text,
        "image_url" character varying(500),
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "pk_design_styles" PRIMARY KEY ("id"),
        CONSTRAINT "uq_design_styles_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "product_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "supplier_id" uuid NOT NULL,
        "parent_id" uuid,
        "code" character varying(50) NOT NULL,
        "name" character varying(150) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "pk_product_categories" PRIMARY KEY ("id"),
        CONSTRAINT "uq_product_categories_supplier_id_code" UNIQUE ("supplier_id", "code"),
        CONSTRAINT "chk_product_categories_parent_id" CHECK ("parent_id" <> "id"),
        CONSTRAINT "fk_product_categories_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "supplier_profiles"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_product_categories_parent_id" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_product_categories_parent_id" ON "product_categories" ("parent_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_categories_parent_id"`);
    await queryRunner.query(`DROP TABLE "product_categories"`);
    await queryRunner.query(`DROP TABLE "design_styles"`);
  }
}
