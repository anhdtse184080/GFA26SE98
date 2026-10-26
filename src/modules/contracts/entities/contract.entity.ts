import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { BusinessRuleError } from '../../../common/errors/index.js';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Project } from '../../projects/entities/project.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { PaymentMilestone } from './payment-milestone.entity.js';

export const CONTRACT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Chuyển trạng thái hợp lệ (DB_CONTEXT §4.3). `COMPLETED`, `CANCELLED` là trạng thái cuối. */
export const CONTRACT_STATUS_TRANSITIONS: Readonly<
  Record<ContractStatus, readonly ContractStatus[]>
> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const ESIGN_STATUSES = [
  'NOT_SENT',
  'AWAITING_CUSTOMER',
  'AWAITING_COMPANY',
  'SIGNED',
] as const;
export type EsignStatus = (typeof ESIGN_STATUSES)[number];

/** Luồng ký (độc lập với `status`): gửi ký → customer ký → đại diện công ty ký; rút lại khi chưa ai ký. */
export const ESIGN_STATUS_TRANSITIONS: Readonly<
  Record<EsignStatus, readonly EsignStatus[]>
> = {
  NOT_SENT: ['AWAITING_CUSTOMER'],
  AWAITING_CUSTOMER: ['AWAITING_COMPANY', 'NOT_SENT'],
  AWAITING_COMPANY: ['SIGNED'],
  SIGNED: [],
};

/**
 * Hợp đồng thiết kế của dự án (1 dự án – tối đa 1 hợp đồng). Soạn ngoài hệ thống, ký trong hệ thống.
 * `unsigned_file_url` / `file_url` lưu **khóa** FileStorage, không phải URL công khai; tải qua `GET /contracts/:id/file`.
 * Điều khoản, lịch thanh toán, file chưa ký chỉ sửa khi `DRAFT` và `esign_status = NOT_SENT`.
 */
@Entity({ name: 'contracts' })
@Unique('uq_contracts_project_id', ['projectId'])
@Unique('uq_contracts_contract_no', ['contractNo'])
@Check('chk_contracts_status', sqlIn('status', CONTRACT_STATUSES))
@Check('chk_contracts_esign_status', sqlIn('esign_status', ESIGN_STATUSES))
@Check('chk_contracts_total_design_fee', '"total_design_fee" > 0')
@Check(
  'chk_contracts_max_revisions_per_stage',
  '"max_revisions_per_stage" >= 0',
)
@Check('chk_contracts_review_window_days', '"review_window_days" > 0')
export class Contract {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_contracts' })
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { nullable: false })
  @JoinColumn({
    name: 'project_id',
    foreignKeyConstraintName: 'fk_contracts_project_id',
  })
  project?: Relation<Project>;

  /** Dạng `HD-YYMMDD-XXXX`, hệ thống sinh. */
  @Column({ name: 'contract_no', type: 'varchar', length: 30 })
  contractNo: string;

  /** VND, NUMERIC(15,2) → string; tính bằng decimal.js. */
  @Column({
    name: 'total_design_fee',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  totalDesignFee: string;

  @Column({ name: 'max_revisions_per_stage', type: 'smallint' })
  maxRevisionsPerStage: number;

  @Column({ name: 'review_window_days', type: 'smallint' })
  reviewWindowDays: number;

  /** Khóa FileStorage của PDF chưa ký. Đổi qua `replaceUnsignedFile`. */
  @Column({
    name: 'unsigned_file_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  unsignedFileKey: string | null;

  @Column({
    name: 'unsigned_file_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  unsignedFileName: string | null;

  /** SHA-256 (hex) của PDF chưa ký. */
  @Column({
    name: 'unsigned_file_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  unsignedFileHash: string | null;

  /** Khóa FileStorage của PDF đã ký (hệ thống sinh). */
  @Column({ name: 'file_url', type: 'varchar', length: 500, nullable: true })
  signedFileKey: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  signedFileName: string | null;

  /** Ngày người ký cuối cùng ký (giờ Việt Nam), `YYYY-MM-DD`. */
  @Column({ name: 'signed_date', type: 'date', nullable: true })
  signedDate: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: ContractStatus;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_contracts_created_by',
  })
  createdBy?: Relation<User>;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({
    name: 'esign_status',
    type: 'varchar',
    length: 20,
    default: 'NOT_SENT',
  })
  esignStatus: EsignStatus;

  @Column({ name: 'esign_sent_at', type: 'timestamptz', nullable: true })
  esignSentAt: Date | null;

  @Column({ name: 'esign_completed_at', type: 'timestamptz', nullable: true })
  esignCompletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Chỉ đọc. Ghi `payment_milestones` qua `ContractsRepository`. */
  @OneToMany(() => PaymentMilestone, (m) => m.contract)
  milestones?: Relation<PaymentMilestone>[];

  /** Điều khoản, lịch thanh toán, file chưa ký chỉ sửa khi DRAFT và chưa gửi ký. */
  isEditable(): boolean {
    return this.status === 'DRAFT' && this.esignStatus === 'NOT_SENT';
  }

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). */
  updateTerms(patch: ContractTermsPatch): void {
    this.assertEditable();
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
  }

  /** Gắn PDF chưa ký mới, trả khóa file cũ (để xóa sau khi commit). */
  replaceUnsignedFile(file: {
    key: string;
    name: string;
    hash: string;
  }): string | null {
    this.assertEditable();
    const previous = this.unsignedFileKey;
    this.unsignedFileKey = file.key;
    this.unsignedFileName = file.name;
    this.unsignedFileHash = file.hash;
    return previous;
  }

  /** @throws BusinessRuleError `CONTRACT_NOT_EDITABLE` */
  assertEditable(): void {
    if (!this.isEditable()) {
      throw new BusinessRuleError(
        'CONTRACT_NOT_EDITABLE',
        'Chỉ sửa được hợp đồng DRAFT chưa gửi ký',
        { status: this.status, esignStatus: this.esignStatus },
      );
    }
  }
}

export type ContractTermsPatch = Partial<
  Pick<
    Contract,
    'totalDesignFee' | 'maxRevisionsPerStage' | 'reviewWindowDays' | 'note'
  >
>;
