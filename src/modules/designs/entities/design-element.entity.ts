import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Room } from '../../apartments/entities/room.entity.js';
import { ProductCategory } from '../../catalog/entities/product-category.entity.js';
import { DesignVersion } from './design-version.entity.js';
import { ProductSelection } from './product-selection.entity.js';

/** Kết quả so kích thước sản phẩm với chỗ của món (chip Fits / Too long… của demo). */
export const PRODUCT_FITS = [
  'FITS',
  'TOO_LONG',
  'TOO_DEEP',
  'TOO_TALL',
  'UNKNOWN',
] as const;
export type ProductFit = (typeof PRODUCT_FITS)[number];

/** Dung sai khi so kích thước (mm). */
const FIT_TOLERANCE_MM = 20;
/** Ngưỡng coi là dời chỗ / xoay (như Compare của demo): 1 mm, 0.5°. */
const MOVE_EPS_M = 0.001;
const ROTATE_EPS_DEG = 0.5;

/** Món dùng để so 2 version (`productId` = sản phẩm đang chọn, null = chưa chọn). */
export interface ComparableElement {
  id: string;
  dxfHandle: string | null;
  blockName: string;
  name: string;
  position: ElementPosition | null;
  overrides: Record<string, unknown> | null;
  productId: string | null;
}

export interface ElementMove<T> {
  from: T;
  to: T;
  /** Mét */
  dx: number;
  dy: number;
  distance: number;
  /** Độ, trong khoảng (-180, 180] */
  rotationDeg: number;
}

export interface ElementComparison<T extends ComparableElement> {
  added: T[];
  removed: T[];
  moved: ElementMove<T>[];
  /** Đổi block trong DXF hoặc đổi sản phẩm đã chọn */
  replaced: { from: T; to: T }[];
  overridesChanged: { from: T; to: T }[];
  /** Món không có handle, không ghép được giữa 2 version */
  unmatched: T[];
}

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

  /** Sản phẩm đã chọn (Core 4); chỉ đọc, ghi qua `DesignVersionsRepository.createWithContent`. Chưa có = Not chosen. */
  @OneToOne(() => ProductSelection, (selection) => selection.designElement)
  selection?: Relation<ProductSelection> | null;

  /**
   * Sản phẩm có vừa chỗ của món không: dài / sâu so với khung món trong DXF (dung sai 20 mm),
   * cao so với chiều cao tường. Thiếu kích thước để so → UNKNOWN.
   */
  static fitOf(
    element: Pick<DesignElement, 'widthMm' | 'depthMm'>,
    product: {
      widthMm: number | null;
      depthMm: number | null;
      heightMm: number | null;
    },
    wallHeightMm: number | null,
  ): ProductFit {
    const over = (size: number | null, room: number | null) =>
      size === null || room === null ? null : size > room + FIT_TOLERANCE_MM;
    const checks: [boolean | null, ProductFit][] = [
      [over(product.widthMm, element.widthMm), 'TOO_LONG'],
      [over(product.depthMm, element.depthMm), 'TOO_DEEP'],
      [
        product.heightMm === null || wallHeightMm === null
          ? null
          : product.heightMm > wallHeightMm,
        'TOO_TALL',
      ],
    ];
    const failed = checks.find(([bad]) => bad === true);
    if (failed) return failed[1];
    return checks.some(([bad]) => bad === false) ? 'FITS' : 'UNKNOWN';
  }

  /**
   * So 2 version cùng giai đoạn (logic Compare của demo): ghép món theo `dxf_handle`;
   * thêm, xóa, dời (vị trí > 1 mm hoặc xoay > 0.5°), đổi mẫu (block khác hoặc sản phẩm chọn khác), đổi thuộc tính.
   */
  static compare<T extends ComparableElement>(
    from: readonly T[],
    to: readonly T[],
  ): ElementComparison<T> {
    const a = DesignElement.indexByHandle(from);
    const b = DesignElement.indexByHandle(to);
    const out: ElementComparison<T> = {
      added: [],
      removed: [],
      moved: [],
      replaced: [],
      overridesChanged: [],
      unmatched: [...from, ...to].filter((e) => e.dxfHandle === null),
    };
    for (const [handle, next] of b) {
      const prev = a.get(handle);
      if (!prev) {
        out.added.push(next);
        continue;
      }
      if (
        prev.blockName !== next.blockName ||
        prev.productId !== next.productId
      ) {
        out.replaced.push({ from: prev, to: next });
      }
      if (
        JSON.stringify(prev.overrides ?? null) !==
        JSON.stringify(next.overrides ?? null)
      ) {
        out.overridesChanged.push({ from: prev, to: next });
      }
      if (prev.position && next.position) {
        const dx = next.position.x - prev.position.x;
        const dy = next.position.y - prev.position.y;
        const distance = Math.hypot(dx, dy);
        let rotationDeg =
          (next.position.rotation_deg - prev.position.rotation_deg) % 360;
        if (rotationDeg > 180) rotationDeg -= 360;
        if (rotationDeg <= -180) rotationDeg += 360;
        if (distance > MOVE_EPS_M || Math.abs(rotationDeg) > ROTATE_EPS_DEG) {
          out.moved.push({
            from: prev,
            to: next,
            dx,
            dy,
            distance,
            rotationDeg,
          });
        }
      }
    }
    for (const [handle, prev] of a) if (!b.has(handle)) out.removed.push(prev);
    return out;
  }

  /**
   * `dxf_handle` → món: nhận lại cùng một món ở version khác (giữ `overrides`, chuyển comment, Compare).
   * Món không có handle không nhận lại được nên bị bỏ qua.
   */
  static indexByHandle<T extends Pick<DesignElement, 'dxfHandle'>>(
    elements: readonly T[],
  ): Map<string, T> {
    const index = new Map<string, T>();
    for (const element of elements) {
      if (element.dxfHandle !== null) index.set(element.dxfHandle, element);
    }
    return index;
  }
}
