import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Căn hộ & dự án (DB_CONTEXT §4.2): apartments, rooms, projects. */
export class CreateApartmentAndProjectTables1791510600009 implements MigrationInterface {
  name = 'CreateApartmentAndProjectTables1791510600009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "apartments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "building_name" character varying(200) NOT NULL,
        "address" character varying(500) NOT NULL,
        "tower" character varying(50),
        "unit_no" character varying(50) NOT NULL,
        "floor_no" smallint,
        "layout_code" character varying(50),
        "net_area" numeric(8,2) NOT NULL,
        "bedroom_count" smallint NOT NULL,
        "bathroom_count" smallint NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_apartments" PRIMARY KEY ("id"),
        CONSTRAINT "chk_apartments_net_area" CHECK ("net_area" > 0),
        CONSTRAINT "chk_apartments_bedroom_count" CHECK ("bedroom_count" >= 0),
        CONSTRAINT "chk_apartments_bathroom_count" CHECK ("bathroom_count" >= 0),
        CONSTRAINT "fk_apartments_owner_id" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_apartments_owner_id" ON "apartments" ("owner_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "apartment_id" uuid NOT NULL,
        "name" character varying(100) NOT NULL,
        "room_type" character varying(20) NOT NULL,
        "area" numeric(8,2),
        "purpose" character varying(255),
        CONSTRAINT "pk_rooms" PRIMARY KEY ("id"),
        CONSTRAINT "chk_rooms_room_type" CHECK ("room_type" IN ('LIVING_ROOM', 'BEDROOM', 'KITCHEN', 'DINING_ROOM', 'BATHROOM', 'WORKING_ROOM', 'BALCONY', 'OTHER')),
        CONSTRAINT "chk_rooms_area" CHECK ("area" > 0),
        CONSTRAINT "fk_rooms_apartment_id" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rooms_apartment_id" ON "rooms" ("apartment_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(30) NOT NULL,
        "customer_id" uuid NOT NULL,
        "apartment_id" uuid NOT NULL,
        "preferred_style_id" uuid,
        "staff_id" uuid NOT NULL,
        "designer_id" uuid,
        "designer_assigned_at" TIMESTAMP WITH TIME ZONE,
        "title" character varying(255) NOT NULL,
        "description" text,
        "household_size" smallint,
        "budget_min" numeric(15,2) NOT NULL,
        "budget_max" numeric(15,2) NOT NULL,
        "budget_tolerance_percent" numeric(5,2) NOT NULL DEFAULT 10,
        "ai_generation_limit" integer NOT NULL,
        "ai_generation_used" integer NOT NULL DEFAULT 0,
        "status" character varying(30) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_projects" PRIMARY KEY ("id"),
        CONSTRAINT "uq_projects_code" UNIQUE ("code"),
        CONSTRAINT "chk_projects_status" CHECK ("status" IN ('DRAFT', 'CONTRACT_PENDING', 'REQUIREMENT_ANALYSIS', 'IN_DESIGN', 'PRODUCT_SELECTION', 'QUOTING', 'COMPLETED', 'CANCELLED')),
        CONSTRAINT "chk_projects_budget_min" CHECK ("budget_min" > 0),
        CONSTRAINT "chk_projects_budget_range" CHECK ("budget_min" <= "budget_max"),
        CONSTRAINT "chk_projects_budget_tolerance_percent" CHECK ("budget_tolerance_percent" BETWEEN 0 AND 10),
        CONSTRAINT "chk_projects_ai_generation_limit" CHECK ("ai_generation_limit" >= 0),
        CONSTRAINT "chk_projects_ai_generation_used" CHECK ("ai_generation_used" >= 0),
        CONSTRAINT "fk_projects_customer_id" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_projects_staff_id" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_projects_apartment_id" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_projects_designer_id" FOREIGN KEY ("designer_id") REFERENCES "designer_profiles"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "fk_projects_preferred_style_id" FOREIGN KEY ("preferred_style_id") REFERENCES "design_styles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_projects_customer_id" ON "projects" ("customer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_projects_staff_id" ON "projects" ("staff_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_projects_designer_id" ON "projects" ("designer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_projects_apartment_id" ON "projects" ("apartment_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_projects_apartment_id"`);
    await queryRunner.query(`DROP INDEX "idx_projects_designer_id"`);
    await queryRunner.query(`DROP INDEX "idx_projects_staff_id"`);
    await queryRunner.query(`DROP INDEX "idx_projects_customer_id"`);
    await queryRunner.query(`DROP TABLE "projects"`);
    await queryRunner.query(`DROP INDEX "idx_rooms_apartment_id"`);
    await queryRunner.query(`DROP TABLE "rooms"`);
    await queryRunner.query(`DROP INDEX "idx_apartments_owner_id"`);
    await queryRunner.query(`DROP TABLE "apartments"`);
  }
}
