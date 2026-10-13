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
import { SupplierProfile } from '../../users/entities/supplier-profile.entity.js';

/**
 * Danh mục sản phẩm dạng cây (`parent_id`), **riêng của từng supplier**: `code` duy nhất trong phạm vi supplier,
 * danh mục cha phải cùng supplier. Không xóa: ẩn bằng `is_active`.
 */
@Entity({ name: 'product_categories' })
@Unique('uq_product_categories_supplier_id_code', ['supplierId', 'code'])
@Check('chk_product_categories_parent_id', '"parent_id" <> "id"')
export class ProductCategory {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_product_categories',
  })
  id: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  /** Chỉ đọc (lấy `company_name` cho Admin); không ghi `supplier_profiles` qua quan hệ này. */
  @ManyToOne(() => SupplierProfile, { nullable: false })
  @JoinColumn({
    name: 'supplier_id',
    referencedColumnName: 'userId',
    foreignKeyConstraintName: 'fk_product_categories_supplier_id',
  })
  supplier?: Relation<SupplierProfile>;

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

  /** `undefined` = giữ nguyên. Không đổi `code`, `supplier_id`; đổi `parentId` qua `moveTo` (service kiểm tra trước). */
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
  Pick<ProductCategory, 'name' | 'isActive'>
>;
