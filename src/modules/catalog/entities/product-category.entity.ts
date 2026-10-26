import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';

/** Nhóm dự toán, khớp `quotation_items.cost_category`. */
export const COST_CATEGORIES = [
  'FURNITURE',
  'FINISHING',
  'LIGHTING',
  'DECOR',
  'OTHER',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/**
 * Danh mục sản phẩm **dùng chung** dạng cây (`parent_id`), chỉ Admin tạo/sửa; supplier chọn danh mục khi tạo sản phẩm.
 * `code` duy nhất toàn bảng, không đổi (là tiền tố `products.block_code`, tên block model minh họa trong DXF).
 * Không xóa: ẩn bằng `is_active`.
 */
@Entity({ name: 'product_categories' })
@Unique('uq_product_categories_code', ['code'])
@Check('chk_product_categories_parent_id', '"parent_id" <> "id"')
@Check(
  'chk_product_categories_cost_category',
  sqlIn('cost_category', COST_CATEGORIES),
)
export class ProductCategory {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_product_categories',
  })
  id: string;

  @Index('idx_product_categories_parent_id')
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => ProductCategory, { nullable: true })
  @JoinColumn({
    name: 'parent_id',
    foreignKeyConstraintName: 'fk_product_categories_parent_id',
  })
  parent?: Relation<ProductCategory> | null;

  @Column({ name: 'code', type: 'varchar', length: 50 })
  code: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Model minh họa (.glb) dùng khi món chưa có sản phẩm thật; đường dẫn tĩnh, không phải khóa FileStorage. */
  @Column({
    name: 'default_model_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  defaultModelUrl: string | null;

  @Column({
    name: 'cost_category',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  costCategory: CostCategory | null;

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Không đổi `code`; đổi `parentId` qua `moveTo` (service kiểm tra trước). */
  update(patch: ProductCategoryPatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
  }

  /** `null` = thành danh mục gốc. */
  moveTo(parentId: string | null): void {
    this.parentId = parentId;
    this.parent = undefined;
  }
}

export type ProductCategoryPatch = Partial<
  Pick<
    ProductCategory,
    'name' | 'isActive' | 'defaultModelUrl' | 'costCategory'
  >
>;
