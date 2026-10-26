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
} from 'typeorm';
import { BusinessRuleError } from '../../../common/errors/index.js';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { User } from '../../users/entities/user.entity.js';
import { DesignVersion } from './design-version.entity.js';

export const REVISION_REQUEST_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
] as const;
export type RevisionRequestStatus = (typeof REVISION_REQUEST_STATUSES)[number];

/**
 * Yêu cầu sửa chính thức, ghi mỗi lần khách bấm yêu cầu sửa (giới hạn sửa đếm theo version `MAJOR`, không theo bảng này).
 * Log trao đổi: không xóa.
 */
@Entity({ name: 'revision_requests' })
@Index('idx_revision_requests_design_version_id', ['designVersionId'])
@Check(
  'chk_revision_requests_status',
  sqlIn('status', REVISION_REQUEST_STATUSES),
)
export class RevisionRequest {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_revision_requests',
  })
  id: string;

  @Column({ name: 'design_version_id', type: 'uuid' })
  designVersionId: string;

  @ManyToOne(() => DesignVersion, { nullable: false })
  @JoinColumn({
    name: 'design_version_id',
    foreignKeyConstraintName: 'fk_revision_requests_design_version_id',
  })
  designVersion?: Relation<DesignVersion>;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedById: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'requested_by',
    foreignKeyConstraintName: 'fk_revision_requests_requested_by',
  })
  requestedBy?: Relation<User>;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: RevisionRequestStatus;

  @Column({ name: 'resolved_in_version_id', type: 'uuid', nullable: true })
  resolvedInVersionId: string | null;

  @ManyToOne(() => DesignVersion, { nullable: true })
  @JoinColumn({
    name: 'resolved_in_version_id',
    foreignKeyConstraintName: 'fk_revision_requests_resolved_in_version_id',
  })
  resolvedInVersion?: Relation<DesignVersion> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  isPending(): boolean {
    return this.status === 'OPEN' || this.status === 'IN_PROGRESS';
  }

  /** Designer đã nộp bản sửa `versionId`. */
  resolve(versionId: string, at: Date): void {
    if (!this.isPending()) {
      throw new BusinessRuleError(
        'INVALID_REVISION_REQUEST_STATUS_TRANSITION',
        `Không thể chuyển yêu cầu sửa từ ${this.status} sang RESOLVED`,
        { from: this.status },
      );
    }
    this.status = 'RESOLVED';
    this.resolvedInVersionId = versionId;
    this.resolvedInVersion = undefined;
    this.resolvedAt = at;
  }
}
