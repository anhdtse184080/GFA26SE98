import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { DesignStyle } from '../../design-styles/entities/design-style.entity.js';
import { Product } from './product.entity.js';

/** Phong cách của sản phẩm (PK kép). Ghi cùng `products` qua `ProductsRepository`. */
@Entity({ name: 'product_styles' })
@Index('idx_product_styles_style_id', ['styleId'])
export class ProductStyle {
  @PrimaryColumn({
    name: 'product_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_product_styles',
  })
  productId: string;

  @PrimaryColumn({
    name: 'style_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_product_styles',
  })
  styleId: string;

  @ManyToOne(() => Product, (product) => product.styles, { nullable: false })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'fk_product_styles_product_id',
  })
  product?: Relation<Product>;

  /** Chỉ đọc (lấy `code`, `name`). */
  @ManyToOne(() => DesignStyle, { nullable: false })
  @JoinColumn({
    name: 'style_id',
    foreignKeyConstraintName: 'fk_product_styles_style_id',
  })
  style?: Relation<DesignStyle>;
}
