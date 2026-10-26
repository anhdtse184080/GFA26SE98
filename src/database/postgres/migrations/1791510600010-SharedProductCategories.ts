import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Danh mục seed cũ (riêng từng supplier) không thuộc 24 danh mục chuẩn của DB_CONTEXT v6 §4.6. */
const LEGACY_SEED_CODES = [
  'FURNITURE',
  'TABLE',
  'CABINET',
  'LIGHTING',
  'DECOR',
  'APPLIANCE',
  'FINISH_MATERIAL',
];

/** Mỗi `code` giữ một danh mục (id nhỏ nhất); các bản trùng của supplier khác gộp vào bản này. */
const KEPT_BY_CODE = `
  SELECT DISTINCT ON ("code") "id", "code" FROM "product_categories" ORDER BY "code", "id"
`;

/**
 * Danh mục sản phẩm dùng chung (DB_CONTEXT v6 §4.6): bỏ `supplier_id`, `code` duy nhất toàn bảng,
 * thêm `default_model_url`, `cost_category`; `products.block_code` (tự sinh `<code danh mục>-<4 chữ số>`).
 * Dữ liệu cũ: gộp danh mục trùng `code` giữa các supplier; xóa danh mục seed cũ không có sản phẩm.
 * 24 danh mục chuẩn do seed tạo (chạy lại không trùng).
 */
export class SharedProductCategories1791510600010 implements MigrationInterface {
  name = 'SharedProductCategories1791510600010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_categories"
        ADD "default_model_url" character varying(500),
        ADD "cost_category" character varying(20),
        ADD CONSTRAINT "chk_product_categories_cost_category" CHECK ("cost_category" IN ('FURNITURE', 'FINISHING', 'LIGHTING', 'DECOR', 'OTHER')),
        DROP CONSTRAINT "uq_product_categories_supplier_id_code",
        DROP CONSTRAINT "fk_product_categories_supplier_id"
    `);

    // Gộp danh mục trùng `code`: chuyển sản phẩm và danh mục con sang bản giữ lại rồi xóa bản trùng.
    await queryRunner.query(`
      WITH "keep" AS (${KEPT_BY_CODE})
      UPDATE "products" p SET "category_id" = k."id"
      FROM "product_categories" c JOIN "keep" k ON k."code" = c."code"
      WHERE p."category_id" = c."id" AND c."id" <> k."id"
    `);
    await queryRunner.query(`
      WITH "keep" AS (${KEPT_BY_CODE})
      UPDATE "product_categories" child SET "parent_id" = k."id"
      FROM "product_categories" c JOIN "keep" k ON k."code" = c."code"
      WHERE child."parent_id" = c."id" AND c."id" <> k."id" AND child."id" <> k."id"
    `);
    await queryRunner.query(`
      WITH "keep" AS (${KEPT_BY_CODE})
      UPDATE "product_categories" SET "parent_id" = NULL
      WHERE "id" IN (SELECT "id" FROM "keep") AND "parent_id" IN (
        SELECT c."id" FROM "product_categories" c WHERE c."id" NOT IN (SELECT "id" FROM "keep")
      )
    `);
    await queryRunner.query(`
      WITH "keep" AS (${KEPT_BY_CODE})
      DELETE FROM "product_categories" WHERE "id" NOT IN (SELECT "id" FROM "keep")
    `);

    // Danh mục seed cũ không có sản phẩm: gỡ khỏi cây rồi xóa.
    const legacy = `
      SELECT c."id" FROM "product_categories" c
      WHERE c."code" = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."category_id" = c."id")
    `;
    await queryRunner.query(
      `UPDATE "product_categories" SET "parent_id" = NULL WHERE "parent_id" IN (${legacy})`,
      [LEGACY_SEED_CODES],
    );
    await queryRunner.query(
      `DELETE FROM "product_categories" WHERE "id" IN (${legacy})`,
      [LEGACY_SEED_CODES],
    );

    await queryRunner.query(`
      ALTER TABLE "product_categories"
        DROP COLUMN "supplier_id",
        ADD CONSTRAINT "uq_product_categories_code" UNIQUE ("code")
    `);

    await queryRunner.query(
      `ALTER TABLE "products" ADD "block_code" character varying(50)`,
    );
    await queryRunner.query(`
      UPDATE "products" p SET "block_code" = n."code" || '-' || lpad(n."seq"::text, greatest(4, length(n."seq"::text)), '0')
      FROM (
        SELECT p2."id", c."code",
               row_number() OVER (PARTITION BY p2."category_id" ORDER BY p2."created_at", p2."id") AS "seq"
        FROM "products" p2 JOIN "product_categories" c ON c."id" = p2."category_id"
      ) n
      WHERE n."id" = p."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ALTER "block_code" SET NOT NULL,
        ADD CONSTRAINT "uq_products_block_code" UNIQUE ("block_code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT "uq_products_block_code",
        DROP COLUMN "block_code"
    `);

    // Gán lại chủ sở hữu: supplier của sản phẩm đầu tiên trong danh mục, không có thì supplier đầu tiên.
    await queryRunner.query(`
      ALTER TABLE "product_categories"
        DROP CONSTRAINT "uq_product_categories_code",
        ADD "supplier_id" uuid
    `);
    await queryRunner.query(`
      UPDATE "product_categories" c SET "supplier_id" = (
        SELECT p."supplier_id" FROM "products" p WHERE p."category_id" = c."id"
        ORDER BY p."created_at", p."id" LIMIT 1
      )
    `);
    await queryRunner.query(`
      UPDATE "product_categories" SET "supplier_id" = (
        SELECT "user_id" FROM "supplier_profiles" ORDER BY "created_at", "user_id" LIMIT 1
      )
      WHERE "supplier_id" IS NULL
    `);
    // Chưa có supplier nào (và danh mục không có sản phẩm): không gán được chủ → xóa.
    await queryRunner.query(`
      UPDATE "product_categories" SET "parent_id" = NULL
      WHERE "parent_id" IN (SELECT "id" FROM "product_categories" WHERE "supplier_id" IS NULL)
    `);
    await queryRunner.query(
      `DELETE FROM "product_categories" WHERE "supplier_id" IS NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "product_categories"
        ALTER "supplier_id" SET NOT NULL,
        ADD CONSTRAINT "uq_product_categories_supplier_id_code" UNIQUE ("supplier_id", "code"),
        ADD CONSTRAINT "fk_product_categories_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "supplier_profiles"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        DROP CONSTRAINT "chk_product_categories_cost_category",
        DROP COLUMN "cost_category",
        DROP COLUMN "default_model_url"
    `);
  }
}
