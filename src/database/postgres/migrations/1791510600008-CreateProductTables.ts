import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Sản phẩm (DB_CONTEXT §4.6): products (riêng từng supplier), product_styles. */
export class CreateProductTables1791510600008 implements MigrationInterface {
  name = 'CreateProductTables1791510600008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "supplier_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "sku" character varying(50) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "brand" character varying(100),
        "material" character varying(100),
        "color_name" character varying(50),
        "color_code" character varying(20),
        "width_mm" integer,
        "depth_mm" integer,
        "height_mm" integer,
        "unit" character varying(10) NOT NULL,
        "price" numeric(15,2) NOT NULL,
        "stock_status" character varying(20) NOT NULL,
        "thumbnail_url" character varying(500),
        "model_3d_url" character varying(500),
        "specifications" jsonb,
        "status" character varying(20) NOT NULL,
        "price_updated_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_products" PRIMARY KEY ("id"),
        CONSTRAINT "uq_products_supplier_id_sku" UNIQUE ("supplier_id", "sku"),
        CONSTRAINT "chk_products_unit" CHECK ("unit" IN ('PIECE', 'SET', 'M2', 'M', 'LITER', 'KG')),
        CONSTRAINT "chk_products_stock_status" CHECK ("stock_status" IN ('IN_STOCK', 'OUT_OF_STOCK', 'PRE_ORDER')),
        CONSTRAINT "chk_products_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "chk_products_price" CHECK ("price" > 0),
        CONSTRAINT "fk_products_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "supplier_profiles"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_products_category_id" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_products_category_id" ON "products" ("category_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "product_styles" (
        "product_id" uuid NOT NULL,
        "style_id" uuid NOT NULL,
        CONSTRAINT "pk_product_styles" PRIMARY KEY ("product_id", "style_id"),
        CONSTRAINT "fk_product_styles_product_id" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_product_styles_style_id" FOREIGN KEY ("style_id") REFERENCES "design_styles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_product_styles_style_id" ON "product_styles" ("style_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_styles_style_id"`);
    await queryRunner.query(`DROP TABLE "product_styles"`);
    await queryRunner.query(`DROP INDEX "idx_products_category_id"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
