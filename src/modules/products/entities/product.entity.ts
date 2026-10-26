import { Decimal } from 'decimal.js';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { SupplierProfile } from '../../users/entities/supplier-profile.entity.js';
import { ProductCategory } from '../../catalog/entities/product-category.entity.js';
import { ProductStyle } from './product-style.entity.js';

export const PRODUCT_UNITS = [
  'PIECE',
  'SET',
  'M2',
  'M',
  'LITER',
  'KG',
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const STOCK_STATUSES = [
  'IN_STOCK',
  'OUT_OF_STOCK',
  'PRE_ORDER',
] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** `INACTIVE` = ngừng bán (thay cho xóa). Chuyển qua lại tự do. */
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * Sản phẩm của supplier đối tác. `sku` duy nhất trong phạm vi supplier; `category_id` là một danh mục dùng chung (Admin tạo).
 * `block_code` duy nhất toàn bảng, hệ thống tự sinh lúc tạo, không đổi về sau.
 * Giá chính thức luôn đọc từ bảng này. Không xóa: ngừng bán bằng `status = INACTIVE`.
 */
@Entity({ name: 'products' })
@Unique('uq_products_supplier_id_sku', ['supplierId', 'sku'])
@Unique('uq_products_block_code', ['blockCode'])
@Index('idx_products_category_id', ['categoryId'])
@Check('chk_products_unit', sqlIn('unit', PRODUCT_UNITS))
@Check('chk_products_stock_status', sqlIn('stock_status', STOCK_STATUSES))
@Check('chk_products_status', sqlIn('status', PRODUCT_STATUSES))
@Check('chk_products_price', '"price" > 0')
export class Product {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_products' })
  id: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  /** Chỉ đọc (`company_name`, `partnership_status`). */
  @ManyToOne(() => SupplierProfile, { nullable: false })
  @JoinColumn({
    name: 'supplier_id',
    referencedColumnName: 'userId',
    foreignKeyConstraintName: 'fk_products_supplier_id',
  })
  supplier?: Relation<SupplierProfile>;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  /** Chỉ đọc; đổi danh mục qua `moveToCategory`. */
  @ManyToOne(() => ProductCategory, { nullable: false })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'fk_products_category_id',
  })
  category?: Relation<ProductCategory>;

  @Column({ name: 'sku', type: 'varchar', length: 50 })
  sku: string;

  /**
   * Tên block trong DXF: `<code danh mục>-<số thứ tự 4 chữ số>` (vd `SOFA-0007`). Gán một lần qua `assignBlockCode`;
   * đổi danh mục không đổi mã này.
   */
  @Column({ name: 'block_code', type: 'varchar', length: 50 })
  blockCode: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'brand', type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  @Column({ name: 'material', type: 'varchar', length: 100, nullable: true })
  material: string | null;

  @Column({ name: 'color_name', type: 'varchar', length: 50, nullable: true })
  colorName: string | null;

  @Column({ name: 'color_code', type: 'varchar', length: 20, nullable: true })
  colorCode: string | null;

  @Column({ name: 'width_mm', type: 'int', nullable: true })
  widthMm: number | null;

  @Column({ name: 'depth_mm', type: 'int', nullable: true })
  depthMm: number | null;

  @Column({ name: 'height_mm', type: 'int', nullable: true })
  heightMm: number | null;

  @Column({ name: 'unit', type: 'varchar', length: 10 })
  unit: ProductUnit;

  /** NUMERIC(15,2) đọc ra dạng string; tính toán bằng `decimal.js`. */
  @Column({ name: 'price', type: 'numeric', precision: 15, scale: 2 })
  price: string;

  @Column({ name: 'stock_status', type: 'varchar', length: 20 })
  stockStatus: StockStatus;

  /**
   * **Khóa** file ảnh trên FileStorage (vd `products/<id>/thumbnail-<ts>.png`), không phải URL công khai.
   * Tên cột giữ theo DB_CONTEXT; client tải qua `GET /products/:id/thumbnail`. Đổi qua `replaceThumbnail`.
   */
  @Column({
    name: 'thumbnail_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  thumbnailKey: string | null;

  /** **Khóa** file model 3D (.glb) trên FileStorage; tải qua `GET /products/:id/model-3d`. Đổi qua `replaceModel3d`. */
  @Column({
    name: 'model_3d_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  model3dKey: string | null;

  @Column({ name: 'specifications', type: 'jsonb', nullable: true })
  specifications: Record<string, unknown> | null;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: ProductStatus;

  @Column({ name: 'price_updated_at', type: 'timestamptz', nullable: true })
  priceUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Chỉ đọc. Ghi `product_styles` qua `ProductsRepository.saveIfSkuAvailable(product, styleIds)`. */
  @OneToMany(() => ProductStyle, (ps) => ps.product)
  styles?: Relation<ProductStyle>[];

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Giá, danh mục, style, file đổi qua method riêng. */
  update(patch: ProductPatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
  }

  /** Chỉ ghi khi giá thật sự đổi, kèm `price_updated_at`. */
  changePrice(price: Decimal, at: Date): void {
    if (this.price !== undefined && new Decimal(this.price).equals(price)) {
      return;
    }
    this.price = price.toFixed(2);
    this.priceUpdatedAt = at;
  }

  /** Chỉ khi tạo sản phẩm; `seq` do service tính (lớn nhất hiện có của tiền tố + 1). */
  assignBlockCode(categoryCode: string, seq: number): void {
    if (this.blockCode !== undefined) {
      throw new Error('block_code đã được gán, không đổi được');
    }
    this.blockCode = `${categoryCode}-${String(seq).padStart(4, '0')}`;
  }

  /** Danh mục mới phải đã được service kiểm tra (tồn tại, đang active). Không đổi `block_code`. */
  moveToCategory(categoryId: string): void {
    this.categoryId = categoryId;
    this.category = undefined;
  }

  /** Gắn khóa ảnh mới (file đã lưu lên storage); trả khóa cũ để xóa sau khi commit. */
  replaceThumbnail(key: string): string | null {
    const previous = this.thumbnailKey;
    this.thumbnailKey = key;
    return previous;
  }

  /** Gắn khóa model 3D mới; trả khóa cũ để xóa sau khi commit. */
  replaceModel3d(key: string): string | null {
    const previous = this.model3dKey;
    this.model3dKey = key;
    return previous;
  }

  /** Model 3D chỉ dành cho Supplier chủ sản phẩm và Designer (dựng cảnh); role khác không được tải. */
  isModel3dVisibleTo(viewer: Pick<AuthUser, 'id' | 'role'>): boolean {
    return (
      viewer.role === 'DESIGNER' ||
      (viewer.role === 'SUPPLIER' && viewer.id === this.supplierId)
    );
  }

  isVisibleToBuyers(): boolean {
    return (
      this.status === 'ACTIVE' && this.supplier?.partnershipStatus === 'ACTIVE'
    );
  }
}

export type ProductPatch = Partial<
  Pick<
    Product,
    | 'sku'
    | 'name'
    | 'description'
    | 'brand'
    | 'material'
    | 'colorName'
    | 'colorCode'
    | 'widthMm'
    | 'depthMm'
    | 'heightMm'
    | 'unit'
    | 'stockStatus'
    | 'specifications'
    | 'status'
  >
>;
