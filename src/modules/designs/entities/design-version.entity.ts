import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Project } from '../../projects/entities/project.entity.js';
import { User } from '../../users/entities/user.entity.js';

export const DESIGN_VERSION_TYPES = [
  'CONCEPT',
  'LAYOUT_2D',
  'RENDER_3D',
] as const;
export type DesignVersionType = (typeof DESIGN_VERSION_TYPES)[number];

/** Designer chọn khi tạo version sửa; bản đầu tiên của mỗi `version_type` và version `CONCEPT` để `null`. */
export const REVISION_TYPES = ['MINOR', 'MAJOR'] as const;
export type RevisionType = (typeof REVISION_TYPES)[number];

/** `UPLOAD` = upload file DXF; `EDIT` = đổi mẫu / chỉnh `overrides` trên web, dùng lại DXF của version cha. */
export const DESIGN_SOURCE_TYPES = ['UPLOAD', 'EDIT'] as const;
export type DesignSourceType = (typeof DESIGN_SOURCE_TYPES)[number];

export const DESIGN_VERSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'REVISION_REQUESTED',
  'APPROVED',
  'SUPERSEDED',
] as const;
export type DesignVersionStatus = (typeof DESIGN_VERSION_STATUSES)[number];

/**
 * Mỗi lần designer nộp bản vẽ, mỗi concept AI, mỗi lần lưu chỉnh sửa trên web. Không xóa.
 * `version_no` tăng theo `(project_id, version_type)`; nhãn v1, v1.1… tính lúc hiển thị.
 * File DXF nằm ở `design_assets` (`DRAWING_2D`). `milestone_id`, `source_generation_id` chưa có FK
 * (thêm khi có `payment_milestones`, `ai_generations`).
 */
@Entity({ name: 'design_versions' })
@Unique('uq_design_versions_project_id_version_type_version_no', [
  'projectId',
  'versionType',
  'versionNo',
])
@Check(
  'chk_design_versions_version_type',
  sqlIn('version_type', DESIGN_VERSION_TYPES),
)
@Check(
  'chk_design_versions_revision_type',
  sqlIn('revision_type', REVISION_TYPES),
)
@Check(
  'chk_design_versions_source_type',
  sqlIn('source_type', DESIGN_SOURCE_TYPES),
)
@Check('chk_design_versions_status', sqlIn('status', DESIGN_VERSION_STATUSES))
@Check('chk_design_versions_version_no', '"version_no" > 0')
@Check('chk_design_versions_parent_version_id', '"parent_version_id" <> "id"')
export class DesignVersion {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_design_versions',
  })
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { nullable: false })
  @JoinColumn({
    name: 'project_id',
    foreignKeyConstraintName: 'fk_design_versions_project_id',
  })
  project?: Relation<Project>;

  /** Đợt thanh toán của giai đoạn (`payment_milestones`); chưa có FK. */
  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId: string | null;

  @Column({ name: 'parent_version_id', type: 'uuid', nullable: true })
  parentVersionId: string | null;

  @ManyToOne(() => DesignVersion, { nullable: true })
  @JoinColumn({
    name: 'parent_version_id',
    foreignKeyConstraintName: 'fk_design_versions_parent_version_id',
  })
  parentVersion?: Relation<DesignVersion> | null;

  @Column({ name: 'version_type', type: 'varchar', length: 20 })
  versionType: DesignVersionType;

  @Column({ name: 'version_no', type: 'integer' })
  versionNo: number;

  @Column({
    name: 'revision_type',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  revisionType: RevisionType | null;

  @Column({ name: 'source_type', type: 'varchar', length: 10 })
  sourceType: DesignSourceType;

  /** Tường, cửa, phòng tự nhận, `unit_scale`, `wall_height`, cảnh báo khi đọc DXF. Chỉ đọc sau khi tạo. */
  @Column({ name: 'scene_json', type: 'jsonb', nullable: true })
  sceneJson: Record<string, unknown> | null;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'status', type: 'varchar', length: 30 })
  status: DesignVersionStatus;

  /** Lượt gọi AI sinh ra version (`ai_generations`); chưa có FK. */
  @Column({ name: 'source_generation_id', type: 'uuid', nullable: true })
  sourceGenerationId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_design_versions_created_by',
  })
  createdBy?: Relation<User>;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
