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
import { BusinessRuleError } from '../../../common/errors/index.js';
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
 * Số version `MAJOR` tối đa trong một `(project_id, version_type)` (DB_CONTEXT §6 quy tắc 7).
 * TODO(contracts): đổi sang `contracts.max_revisions_per_stage` khi có module contracts.
 */
export const MAX_MAJOR_REVISIONS_PER_STAGE = 3;

/**
 * Chuyển trạng thái hợp lệ. `SUPERSEDED → APPROVED`: khách chọn duyệt một bản cũ (quy tắc 7).
 * `APPROVED` là trạng thái cuối.
 */
const DESIGN_VERSION_STATUS_TRANSITIONS: Readonly<
  Record<DesignVersionStatus, readonly DesignVersionStatus[]>
> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['REVISION_REQUESTED', 'APPROVED', 'SUPERSEDED'],
  REVISION_REQUESTED: ['APPROVED', 'SUPERSEDED'],
  SUPERSEDED: ['APPROVED'],
  APPROVED: [],
};

/** Đủ để tính nhãn / đếm Major (version cùng `version_type`). */
export type VersionRevisionInfo = Pick<
  DesignVersion,
  'id' | 'versionNo' | 'revisionType'
>;

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

  /**
   * Nhãn hiển thị theo từng `version_type` (DB_CONTEXT §4.5): số chính = 1 + số bản `MAJOR` tính đến bản đó,
   * số sau dấu chấm = số bản `MINOR` kể từ bản `MAJOR` gần nhất. `versions` cùng một `version_type`.
   */
  static labelsOf(
    versions: readonly VersionRevisionInfo[],
  ): Map<string, string> {
    const labels = new Map<string, string>();
    let major = 0;
    let minor = 0;
    [...versions]
      .sort((a, b) => a.versionNo - b.versionNo)
      .forEach((v, i) => {
        if (i === 0 || v.revisionType === 'MAJOR') {
          major += 1;
          minor = 0;
        } else {
          minor += 1;
        }
        labels.set(v.id, minor ? `v${major}.${minor}` : `v${major}`);
      });
    return labels;
  }

  /**
   * Tường (viền + đường tim, làm tròn mm) và cửa / cửa sổ (handle, block, vị trí, bề rộng) giữa 2 `scene_json` có khác không.
   */
  static compareScenes(
    from: Record<string, unknown> | null,
    to: Record<string, unknown> | null,
  ): { wallsChanged: boolean; openingsChanged: boolean } {
    const mm = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(mm)
        : typeof v === 'number'
          ? Math.round(v * 1000)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mm(x)]))
            : v;
    const walls = (s: Record<string, unknown> | null) =>
      JSON.stringify(mm([s?.walls ?? [], s?.wallSegments ?? []]));
    const openings = (s: Record<string, unknown> | null) =>
      JSON.stringify(
        mm(
          ((s?.openings ?? []) as Record<string, unknown>[])
            .map((o) => [o.handle, o.blockName, o.x, o.y, o.width])
            .sort((p, q) => String(p[0]).localeCompare(String(q[0]))),
        ),
      );
    return {
      wallsChanged: walls(from) !== walls(to),
      openingsChanged: openings(from) !== openings(to),
    };
  }

  /** Số bản `MAJOR` đã dùng (quy tắc 7; `MINOR` không tính). `versions` cùng một `version_type`. */
  static countMajor(versions: readonly VersionRevisionInfo[]): number {
    return versions.filter((v) => v.revisionType === 'MAJOR').length;
  }

  /** Đang chờ khách xem (bản mới nhất chưa bị thay, chưa duyệt). */
  isAwaitingReview(): boolean {
    return this.status === 'SUBMITTED' || this.status === 'REVISION_REQUESTED';
  }

  /** SUBMITTED → REVISION_REQUESTED; đã ở REVISION_REQUESTED thì giữ nguyên (khách gửi thêm yêu cầu). */
  requestRevision(): void {
    if (this.status === 'REVISION_REQUESTED') return;
    this.transitionTo('REVISION_REQUESTED');
  }

  approve(at: Date): void {
    this.transitionTo('APPROVED');
    this.approvedAt = at;
  }

  /** Bản mới hơn thay bản này (upload bản sửa, hoặc khách duyệt một bản cũ hơn). */
  supersede(): void {
    if (this.status === 'SUPERSEDED') return;
    this.transitionTo('SUPERSEDED');
  }

  private transitionTo(next: DesignVersionStatus): void {
    if (!DESIGN_VERSION_STATUS_TRANSITIONS[this.status].includes(next)) {
      throw new BusinessRuleError(
        'INVALID_DESIGN_VERSION_STATUS_TRANSITION',
        `Không thể chuyển version từ ${this.status} sang ${next}`,
        { from: this.status, to: next },
      );
    }
    this.status = next;
  }
}
