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
import { Room } from '../../apartments/entities/room.entity.js';
import { ProductCategory } from '../../catalog/entities/product-category.entity.js';
import { DesignVersion } from './design-version.entity.js';

/** Gán theo layer DXF: đồ nội thất → FURNITURE, đèn → LIGHTING, đồ treo tường → DECOR. */
export const DESIGN_ELEMENT_TYPES = [
  'FURNITURE',
  'LIGHTING',
  'DECOR',
  'APPLIANCE',
  'FINISH_MATERIAL',
  'OTHER',
] as const;
export type DesignElementType = (typeof DESIGN_ELEMENT_TYPES)[number];

/** Vị trí trên mặt bằng (mét). */
export interface ElementPosition {
  x: number;
  y: number;
  rotation_deg: number;
}

/**
 * Vật thể trong bản vẽ (chỗ gắn sản phẩm thật). Cửa, cửa sổ, tường nằm trong `design_versions.scene_json`.
 * `dxf_handle` không đổi khi dời/xoay: nhận ra cùng một món qua các version.
 * `block_name` = `products.block_code` (mẫu thật) hoặc `product_categories.code` (model minh họa).
 */
@Entity({ name: 'design_elements' })
@Unique('uq_design_elements_design_version_id_dxf_handle', [
  'designVersionId',
  'dxfHandle',
])
@Check(
  'chk_design_elements_element_type',
  sqlIn('element_type', DESIGN_ELEMENT_TYPES),
)
@Check('chk_design_elements_width_mm', '"width_mm" > 0')
@Check('chk_design_elements_depth_mm', '"depth_mm" > 0')
@Check('chk_design_elements_height_mm', '"height_mm" > 0')
export class DesignElement {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_design_elements',
  })
  id: string;

  @Column({ name: 'design_version_id', type: 'uuid' })
  designVersionId: string;

  @ManyToOne(() => DesignVersion, { nullable: false })
  @JoinColumn({
    name: 'design_version_id',
    foreignKeyConstraintName: 'fk_design_elements_design_version_id',
  })
  designVersion?: Relation<DesignVersion>;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @ManyToOne(() => Room, { nullable: true })
  @JoinColumn({
    name: 'room_id',
    foreignKeyConstraintName: 'fk_design_elements_room_id',
  })
  room?: Relation<Room> | null;

  /** Đổi mẫu: sản phẩm mới phải cùng `category_id`. */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => ProductCategory, { nullable: true })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'fk_design_elements_category_id',
  })
  category?: Relation<ProductCategory> | null;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'element_type', type: 'varchar', length: 20 })
  elementType: DesignElementType;

  @Column({ name: 'position', type: 'jsonb', nullable: true })
  position: ElementPosition | null;

  /** Đổi đơn vị từ DXF sang mm lúc đọc file. */
  @Column({ name: 'width_mm', type: 'int', nullable: true })
  widthMm: number | null;

  @Column({ name: 'depth_mm', type: 'int', nullable: true })
  depthMm: number | null;

  @Column({ name: 'height_mm', type: 'int', nullable: true })
  heightMm: number | null;

  @Column({ name: 'color_code', type: 'varchar', length: 20, nullable: true })
  colorCode: string | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'dxf_handle', type: 'varchar', length: 16, nullable: true })
  dxfHandle: string | null;

  @Column({ name: 'block_name', type: 'varchar', length: 100 })
  blockName: string;

  /** Thuộc tính chỉnh trên web (cao độ đồ treo, đèn bật/tắt…). */
  @Column({ name: 'overrides', type: 'jsonb', nullable: true })
  overrides: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
