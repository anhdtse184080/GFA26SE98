import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { BusinessRuleError } from '../../../common/errors/index.js';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Apartment } from '../../apartments/entities/apartment.entity.js';
import { DesignStyle } from '../../design-styles/entities/design-style.entity.js';
import { DesignerProfile } from '../../users/entities/designer-profile.entity.js';
import { User } from '../../users/entities/user.entity.js';

export const PROJECT_STATUSES = [
  'DRAFT',
  'CONTRACT_PENDING',
  'REQUIREMENT_ANALYSIS',
  'IN_DESIGN',
  'PRODUCT_SELECTION',
  'QUOTING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Chuyển trạng thái hợp lệ (DB_CONTEXT §4.2). `COMPLETED` và `CANCELLED` là trạng thái cuối. */
const PROJECT_STATUS_TRANSITIONS: Readonly<
  Record<ProjectStatus, readonly ProjectStatus[]>
> = {
  DRAFT: ['CONTRACT_PENDING', 'CANCELLED'],
  CONTRACT_PENDING: ['REQUIREMENT_ANALYSIS', 'CANCELLED'],
  REQUIREMENT_ANALYSIS: ['IN_DESIGN', 'CANCELLED'],
  IN_DESIGN: ['PRODUCT_SELECTION', 'CANCELLED'],
  PRODUCT_SELECTION: ['QUOTING', 'CANCELLED'],
  QUOTING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Dự án thiết kế, do Staff tạo. `customer_id` = chủ căn hộ (`apartments.owner_id`), `apartment_id`,
 * `staff_id`, `code`, hạn mức AI không đổi sau khi tạo.
 */
@Entity({ name: 'projects' })
@Unique('uq_projects_code', ['code'])
@Index('idx_projects_customer_id', ['customerId'])
@Index('idx_projects_staff_id', ['staffId'])
@Index('idx_projects_designer_id', ['designerId'])
@Index('idx_projects_apartment_id', ['apartmentId'])
@Check('chk_projects_status', sqlIn('status', PROJECT_STATUSES))
@Check('chk_projects_budget_min', '"budget_min" > 0')
@Check('chk_projects_budget_range', '"budget_min" <= "budget_max"')
@Check(
  'chk_projects_budget_tolerance_percent',
  '"budget_tolerance_percent" BETWEEN 0 AND 10',
)
@Check('chk_projects_ai_generation_limit', '"ai_generation_limit" >= 0')
@Check('chk_projects_ai_generation_used', '"ai_generation_used" >= 0')
export class Project {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_projects' })
  id: string;

  /** Dạng `PRJ-YYMMDD-XXXX`. */
  @Column({ name: 'code', type: 'varchar', length: 30 })
  code: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  /** Chỉ đọc (họ tên, email customer). */
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'customer_id',
    foreignKeyConstraintName: 'fk_projects_customer_id',
  })
  customer?: Relation<User>;

  @Column({ name: 'apartment_id', type: 'uuid' })
  apartmentId: string;

  @ManyToOne(() => Apartment, { nullable: false })
  @JoinColumn({
    name: 'apartment_id',
    foreignKeyConstraintName: 'fk_projects_apartment_id',
  })
  apartment?: Relation<Apartment>;

  @Column({ name: 'preferred_style_id', type: 'uuid', nullable: true })
  preferredStyleId: string | null;

  @ManyToOne(() => DesignStyle, { nullable: true })
  @JoinColumn({
    name: 'preferred_style_id',
    foreignKeyConstraintName: 'fk_projects_preferred_style_id',
  })
  preferredStyle?: Relation<DesignStyle> | null;

  @Column({ name: 'staff_id', type: 'uuid' })
  staffId: string;

  /** Chỉ đọc (họ tên Staff phụ trách). */
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'staff_id',
    foreignKeyConstraintName: 'fk_projects_staff_id',
  })
  staff?: Relation<User>;

  @Column({ name: 'designer_id', type: 'uuid', nullable: true })
  designerId: string | null;

  @ManyToOne(() => DesignerProfile, { nullable: true })
  @JoinColumn({
    name: 'designer_id',
    referencedColumnName: 'userId',
    foreignKeyConstraintName: 'fk_projects_designer_id',
  })
  designer?: Relation<DesignerProfile> | null;

  @Column({
    name: 'designer_assigned_at',
    type: 'timestamptz',
    nullable: true,
  })
  designerAssignedAt: Date | null;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'household_size', type: 'smallint', nullable: true })
  householdSize: number | null;

  /** VND, NUMERIC(15,2) → string; tính bằng decimal.js. */
  @Column({ name: 'budget_min', type: 'numeric', precision: 15, scale: 2 })
  budgetMin: string;

  @Column({ name: 'budget_max', type: 'numeric', precision: 15, scale: 2 })
  budgetMax: string;

  @Column({
    name: 'budget_tolerance_percent',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 10,
  })
  budgetTolerancePercent: string;

  @Column({ name: 'ai_generation_limit', type: 'integer' })
  aiGenerationLimit: number;

  @Column({ name: 'ai_generation_used', type: 'integer', default: 0 })
  aiGenerationUsed: number;

  @Column({ name: 'status', type: 'varchar', length: 30 })
  status: ProjectStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Chỉ các field Staff được sửa khi DRAFT. */
  update(patch: ProjectPatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
    if (patch.preferredStyleId !== undefined) this.preferredStyle = undefined;
  }

  /** DRAFT → CONTRACT_PENDING (khi Staff tạo hợp đồng). */
  markContractPending(): void {
    this.transitionTo('CONTRACT_PENDING');
  }

  private transitionTo(next: ProjectStatus): void {
    if (!PROJECT_STATUS_TRANSITIONS[this.status].includes(next)) {
      throw new BusinessRuleError(
        'INVALID_PROJECT_STATUS_TRANSITION',
        `Không thể chuyển dự án từ ${this.status} sang ${next}`,
        { from: this.status, to: next },
      );
    }
    this.status = next;
  }
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | 'title'
    | 'description'
    | 'householdSize'
    | 'preferredStyleId'
    | 'budgetMin'
    | 'budgetMax'
    | 'budgetTolerancePercent'
  >
>;
