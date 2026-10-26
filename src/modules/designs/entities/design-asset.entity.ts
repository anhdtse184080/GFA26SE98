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
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Project } from '../../projects/entities/project.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { DesignVersion } from './design-version.entity.js';

export const DESIGN_ASSET_TYPES = [
  'INPUT_FLOOR_PLAN',
  'INPUT_PHOTO',
  'INPUT_VIDEO',
  'DRAWING_2D',
  'MODEL_3D',
  'RENDER_IMAGE',
  'AI_VISUALIZATION',
  'DOCUMENT',
] as const;
export type DesignAssetType = (typeof DESIGN_ASSET_TYPES)[number];

/** File dự án: file đầu vào (`design_version_id` null) và file của từng version (DXF của version: `DRAWING_2D`). */
@Entity({ name: 'design_assets' })
@Index('idx_design_assets_project_id', ['projectId'])
@Index('idx_design_assets_design_version_id', ['designVersionId'])
@Check('chk_design_assets_asset_type', sqlIn('asset_type', DESIGN_ASSET_TYPES))
@Check('chk_design_assets_size_bytes', '"size_bytes" >= 0')
export class DesignAsset {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_design_assets',
  })
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { nullable: false })
  @JoinColumn({
    name: 'project_id',
    foreignKeyConstraintName: 'fk_design_assets_project_id',
  })
  project?: Relation<Project>;

  @Column({ name: 'design_version_id', type: 'uuid', nullable: true })
  designVersionId: string | null;

  @ManyToOne(() => DesignVersion, { nullable: true })
  @JoinColumn({
    name: 'design_version_id',
    foreignKeyConstraintName: 'fk_design_assets_design_version_id',
  })
  designVersion?: Relation<DesignVersion> | null;

  @Column({ name: 'asset_type', type: 'varchar', length: 30 })
  assetType: DesignAssetType;

  /**
   * **Khóa** file trên FileStorage (vd `projects/<id>/assets/<assetId>.dxf`), không phải URL công khai.
   * Tên cột giữ theo DB_CONTEXT; client tải qua API có kiểm tra quyền.
   */
  @Column({ name: 'file_url', type: 'varchar', length: 500 })
  fileKey: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  /** BIGINT → string. */
  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: string;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedById: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'uploaded_by',
    foreignKeyConstraintName: 'fk_design_assets_uploaded_by',
  })
  uploadedBy?: Relation<User>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
