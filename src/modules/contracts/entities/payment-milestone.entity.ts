import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { DesignVersion } from '../../designs/entities/design-version.entity.js';
import { Contract } from './contract.entity.js';

export const MILESTONE_STAGE_TYPES = [
  'DEPOSIT',
  'LAYOUT_2D',
  'RENDER_3D',
  'FINAL_PACKAGE',
] as const;
export type MilestoneStageType = (typeof MILESTONE_STAGE_TYPES)[number];

export const MILESTONE_DUE_TRIGGERS = [
  'ON_CONTRACT_ACTIVE',
  'ON_STAGE_APPROVED',
] as const;
export type MilestoneDueTrigger = (typeof MILESTONE_DUE_TRIGGERS)[number];

export const MILESTONE_STATUSES = [
  'PENDING',
  'INVOICED',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Chuyển trạng thái hợp lệ (DB_CONTEXT §4.4, §6 quy tắc 8). `PAID`, `CANCELLED` là trạng thái cuối. */
export const MILESTONE_STATUS_TRANSITIONS: Readonly<
  Record<MilestoneStatus, readonly MilestoneStatus[]>
> = {
  PENDING: ['INVOICED', 'CANCELLED'],
  INVOICED: ['PAID', 'OVERDUE', 'CANCELLED'],
  OVERDUE: ['PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

/** Đợt thanh toán của hợp đồng; Staff nhập trước khi gửi ký. Ghi cùng `contracts` qua `ContractsRepository`. */
@Entity({ name: 'payment_milestones' })
@Unique('uq_payment_milestones_contract_id_seq_no', ['contractId', 'seqNo'])
@Check(
  'chk_payment_milestones_stage_type',
  sqlIn('stage_type', MILESTONE_STAGE_TYPES),
)
@Check(
  'chk_payment_milestones_due_trigger',
  sqlIn('due_trigger', MILESTONE_DUE_TRIGGERS),
)
@Check('chk_payment_milestones_status', sqlIn('status', MILESTONE_STATUSES))
@Check('chk_payment_milestones_seq_no', '"seq_no" > 0')
@Check('chk_payment_milestones_amount', '"amount" > 0')
export class PaymentMilestone {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_payment_milestones',
  })
  id: string;

  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @ManyToOne(() => Contract, (c) => c.milestones, { nullable: false })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'fk_payment_milestones_contract_id',
  })
  contract?: Relation<Contract>;

  @Column({ name: 'seq_no', type: 'smallint' })
  seqNo: number;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'stage_type', type: 'varchar', length: 20 })
  stageType: MilestoneStageType;

  /** VND, NUMERIC(15,2) → string. Tổng các đợt = `contracts.total_design_fee`. */
  @Column({ name: 'amount', type: 'numeric', precision: 15, scale: 2 })
  amount: string;

  @Column({ name: 'due_trigger', type: 'varchar', length: 30 })
  dueTrigger: MilestoneDueTrigger;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'PENDING' })
  status: MilestoneStatus;

  @Column({ name: 'approved_version_id', type: 'uuid', nullable: true })
  approvedVersionId: string | null;

  @ManyToOne(() => DesignVersion, { nullable: true })
  @JoinColumn({
    name: 'approved_version_id',
    foreignKeyConstraintName: 'fk_payment_milestones_approved_version_id',
  })
  approvedVersion?: Relation<DesignVersion> | null;

  @Column({ name: 'review_deadline', type: 'timestamptz', nullable: true })
  reviewDeadline: Date | null;

  @Column({ name: 'auto_approved', type: 'boolean', default: false })
  autoApproved: boolean;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'invoiced_at', type: 'timestamptz', nullable: true })
  invoicedAt: Date | null;

  /** Hạn thanh toán, `YYYY-MM-DD`. */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
