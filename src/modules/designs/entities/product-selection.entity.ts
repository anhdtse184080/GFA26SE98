import { Decimal } from 'decimal.js';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { BusinessRuleError } from '../../../common/errors/index.js';
import { Product } from '../../products/entities/product.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { DesignElement } from './design-element.entity.js';

/** Món trong bản đang sửa: chỉ những gì cần để dựng bản mới. */
export interface EditableElement {
  id: string;
  categoryId: string | null;
  blockName: string;
  overrides: Record<string, unknown> | null;
  selection: SelectionData | null;
}

/** Nội dung một selection (chưa gắn element). */
export interface SelectionData {
  productId: string;
  quantity: string;
  unitPriceSnapshot: string;
  recommendationId: string | null;
  selectedById: string;
  note: string | null;
}

/** Sản phẩm chọn được (ACTIVE, supplier đang hợp tác). */
export interface ChoosableProduct {
  id: string;
  categoryId: string;
  blockCode: string;
  price: string;
}

export interface EditInput {
  elements: readonly EditableElement[];
  selections: readonly { elementId: string; productId: string }[];
  overrides: readonly {
    elementId: string;
    overrides: Record<string, unknown>;
  }[];
  /** "Choose all remaining": món có danh mục chưa chọn mà block trùng `block_code` một sản phẩm → chọn sản phẩm đó. */
  chooseAllRemaining: boolean;
  /** Sản phẩm chọn được, tra theo id và theo `block_code`. */
  products: ReadonlyMap<string, ChoosableProduct>;
  productsByBlockCode: ReadonlyMap<string, ChoosableProduct>;
  actorId: string;
}

export interface PlannedElement {
  /** Món ở bản cha (chép mọi thuộc tính, giữ `dxf_handle`). */
  source: EditableElement;
  overrides: Record<string, unknown> | null;
  selection: SelectionData | null;
}

export interface EditPlan {
  items: PlannedElement[];
  /** Số món có thay đổi (mẫu hoặc thuộc tính). */
  changed: number;
  /** Số món có danh mục còn chưa chọn mẫu. */
  unchosen: number;
}

/**
 * Gắn 1 sản phẩm vào 1 vật thể (1 element – tối đa 1 selection). Giá lưu snapshot lúc chọn (quy tắc 9);
 * chép sang version mới thì giữ snapshot cũ, chỉ đổi khi chọn lại.
 * `recommendation_id` chưa có FK (thêm khi có `ai_recommendations`).
 */
@Entity({ name: 'product_selections' })
@Unique('uq_product_selections_design_element_id', ['designElementId'])
@Index('idx_product_selections_product_id', ['productId'])
@Check('chk_product_selections_quantity', '"quantity" > 0')
@Check(
  'chk_product_selections_unit_price_snapshot',
  '"unit_price_snapshot" >= 0',
)
export class ProductSelection {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_product_selections',
  })
  id: string;

  @Column({ name: 'design_element_id', type: 'uuid' })
  designElementId: string;

  @OneToOne(() => DesignElement, (element) => element.selection, {
    nullable: false,
  })
  @JoinColumn({
    name: 'design_element_id',
    foreignKeyConstraintName: 'fk_product_selections_design_element_id',
  })
  designElement?: Relation<DesignElement>;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Chỉ đọc (tên, giá hiện tại, supplier, model 3D). */
  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'fk_product_selections_product_id',
  })
  product?: Relation<Product>;

  /** NUMERIC(12,2) → string. */
  @Column({
    name: 'quantity',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 1,
  })
  quantity: string;

  /** VND, NUMERIC(15,2) → string; giá sản phẩm lúc chọn. */
  @Column({
    name: 'unit_price_snapshot',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  unitPriceSnapshot: string;

  /** Đề xuất AI dẫn tới lựa chọn này (`ai_recommendations`); chưa có FK. */
  @Column({ name: 'recommendation_id', type: 'uuid', nullable: true })
  recommendationId: string | null;

  @Column({ name: 'selected_by', type: 'uuid' })
  selectedById: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'selected_by',
    foreignKeyConstraintName: 'fk_product_selections_selected_by',
  })
  selectedBy?: Relation<User>;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Thành tiền = số lượng × giá snapshot (decimal.js, 2 chữ số). */
  static lineTotal(
    selection: Pick<SelectionData, 'quantity' | 'unitPriceSnapshot'>,
  ): string {
    return new Decimal(selection.quantity)
      .times(selection.unitPriceSnapshot)
      .toFixed(2);
  }

  /** Tổng tạm tính của các món đã chọn. */
  static totalOf(
    selections: readonly (Pick<
      SelectionData,
      'quantity' | 'unitPriceSnapshot'
    > | null)[],
  ): string {
    return selections
      .reduce(
        (sum, s) => (s ? sum.plus(ProductSelection.lineTotal(s)) : sum),
        new Decimal(0),
      )
      .toFixed(2);
  }

  /** Lựa chọn mới cho sản phẩm `product`, snapshot = giá hiện tại. */
  static choose(product: ChoosableProduct, actorId: string): SelectionData {
    return {
      productId: product.id,
      quantity: '1',
      unitPriceSnapshot: new Decimal(product.price).toFixed(2),
      recommendationId: null,
      selectedById: actorId,
      note: null,
    };
  }

  /**
   * Dựng bản EDIT mới từ bản cha (DB_CONTEXT §6 quy tắc 6): chép mọi món + lựa chọn (giữ snapshot),
   * áp `overrides`, đổi mẫu trong cùng danh mục (snapshot = giá hiện tại), rồi "Choose all remaining".
   * Không thêm / xóa / dời món (việc của AutoCAD).
   * @throws BusinessRuleError `ELEMENT_NOT_IN_VERSION` | `PRODUCT_NOT_AVAILABLE` | `PRODUCT_CATEGORY_MISMATCH`
   */
  static planEdit(input: EditInput): EditPlan {
    const byId = new Map(input.elements.map((e) => [e.id, e]));
    const element = (id: string, seen: Set<string>) => {
      const found = byId.get(id);
      if (!found || seen.has(id)) {
        throw new BusinessRuleError(
          'ELEMENT_NOT_IN_VERSION',
          found
            ? 'Một món chỉ được sửa một lần trong mỗi lần lưu'
            : 'Món không thuộc version này',
          { elementId: id },
        );
      }
      seen.add(id);
      return found;
    };

    const overrides = new Map<string, Record<string, unknown>>();
    const seenOverrides = new Set<string>();
    for (const o of input.overrides) {
      overrides.set(element(o.elementId, seenOverrides).id, o.overrides);
    }
    const chosen = new Map<string, ChoosableProduct>();
    const seenSelections = new Set<string>();
    for (const s of input.selections) {
      const target = element(s.elementId, seenSelections);
      const product = input.products.get(s.productId);
      if (!product) {
        throw new BusinessRuleError(
          'PRODUCT_NOT_AVAILABLE',
          'Sản phẩm không tồn tại hoặc đang ngừng bán',
          { productId: s.productId },
        );
      }
      if (product.categoryId !== target.categoryId) {
        throw new BusinessRuleError(
          'PRODUCT_CATEGORY_MISMATCH',
          'Chỉ đổi được sang sản phẩm cùng danh mục với món',
          {
            elementId: target.id,
            productId: product.id,
            elementCategoryId: target.categoryId,
            productCategoryId: product.categoryId,
          },
        );
      }
      chosen.set(target.id, product);
    }

    let changed = 0;
    let unchosen = 0;
    const items = input.elements.map((source): PlannedElement => {
      let selection = source.selection;
      const pick = chosen.get(source.id);
      if (pick && pick.id !== selection?.productId) {
        selection = ProductSelection.choose(pick, input.actorId);
      } else if (!selection && input.chooseAllRemaining && source.categoryId) {
        const same = input.productsByBlockCode.get(source.blockName);
        if (same && same.categoryId === source.categoryId) {
          selection = ProductSelection.choose(same, input.actorId);
        }
      }
      const nextOverrides = overrides.has(source.id)
        ? (overrides.get(source.id) ?? null)
        : source.overrides;
      if (
        selection !== source.selection ||
        JSON.stringify(nextOverrides) !== JSON.stringify(source.overrides)
      ) {
        changed += 1;
      }
      if (source.categoryId && !selection) unchosen += 1;
      return { source, overrides: nextOverrides, selection };
    });
    return { items, changed, unchosen };
  }
}
