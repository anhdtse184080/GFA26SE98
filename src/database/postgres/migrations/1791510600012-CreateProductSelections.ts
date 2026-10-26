import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chọn sản phẩm thật cho vật thể (DB_CONTEXT v6 §4.6): `product_selections`, 1 element – tối đa 1 selection.
 * `recommendation_id`: cột UUID, FK thêm sau khi có `ai_recommendations`.
 */
export class CreateProductSelections1791510600012 implements MigrationInterface {
  name = 'CreateProductSelections1791510600012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_selections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "design_element_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "quantity" numeric(12,2) NOT NULL DEFAULT 1,
        "unit_price_snapshot" numeric(15,2) NOT NULL,
        "recommendation_id" uuid,
        "selected_by" uuid NOT NULL,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_product_selections" PRIMARY KEY ("id"),
        CONSTRAINT "uq_product_selections_design_element_id" UNIQUE ("design_element_id"),
        CONSTRAINT "chk_product_selections_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "chk_product_selections_unit_price_snapshot" CHECK ("unit_price_snapshot" >= 0),
        CONSTRAINT "fk_product_selections_design_element_id" FOREIGN KEY ("design_element_id") REFERENCES "design_elements"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_product_selections_product_id" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_product_selections_selected_by" FOREIGN KEY ("selected_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_product_selections_product_id" ON "product_selections" ("product_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_selections_product_id"`);
    await queryRunner.query(`DROP TABLE "product_selections"`);
  }
}
