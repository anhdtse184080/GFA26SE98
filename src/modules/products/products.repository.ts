import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { escapeLike } from '../../database/postgres/escape-like.js';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import {
  Product,
  type ProductStatus,
  type StockStatus,
} from './entities/product.entity.js';
import { ProductStyle } from './entities/product-style.entity.js';

/** UUID không bao giờ khớp, thay cho danh sách rỗng trong `IN (...)`. */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

export interface ProductSearchFilter {
  supplierId?: string;
  /** Tìm trong tên hoặc sku (không phân biệt hoa thường). */
  keyword?: string;
  categoryId?: string;
  styleId?: string;
  /** Chuỗi số thập phân, so sánh trong SQL (NUMERIC). */
  minPrice?: string;
  maxPrice?: string;
  stockStatus?: StockStatus;
  status?: ProductStatus;
  /** Chỉ sản phẩm ACTIVE của supplier đang hợp tác (Designer/Staff chọn đồ). */
  visibleToBuyers?: boolean;
}

/**
 * `products` + `product_styles` (bảng con ghi cùng sản phẩm). Không có `delete`: ngừng bán bằng `status`.
 * JOIN `product_categories`, `supplier_profiles`, `design_styles` chỉ để đọc.
 */
@Injectable()
export class ProductsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(Product);
  }

  findById(id: string): Promise<Product | null> {
    return this.repo.findOne({
      where: { id },
      relations: { category: true, supplier: true, styles: { style: true } },
    });
  }

  /** Chỉ cột của `products`, khóa dòng (`FOR UPDATE`) đến hết transaction: dùng khi thay file. */
  findByIdForUpdate(id: string): Promise<Product | null> {
    return this.repo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Sản phẩm chọn được (ACTIVE, supplier đang hợp tác) của một danh mục, rẻ trước; kèm supplier. */
  async findChoosableByCategory(
    categoryId: string,
    page: PageRequest,
  ): Promise<Paginated<Product>> {
    const [items, total] = await this.choosable()
      .andWhere('p.categoryId = :categoryId', { categoryId })
      .orderBy('p.price', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .skip((page.page - 1) * page.limit)
      .take(page.limit)
      .getManyAndCount();
    return { items, page: page.page, limit: page.limit, total };
  }

  /** Sản phẩm chọn được theo id và / hoặc `block_code`; kèm supplier. */
  findChoosable(filter: {
    ids?: readonly string[];
    blockCodes?: readonly string[];
  }): Promise<Product[]> {
    const ids = filter.ids ?? [];
    const blockCodes = filter.blockCodes ?? [];
    if (!ids.length && !blockCodes.length) return Promise.resolve([]);
    return this.choosable()
      .andWhere(
        '(p.id IN (:...ids) OR p.blockCode IN (:...blockCodes))',
        // IN () rỗng không hợp lệ: thêm giá trị không bao giờ khớp
        {
          ids: ids.length ? [...ids] : [NO_MATCH_ID],
          blockCodes: blockCodes.length ? [...blockCodes] : [''],
        },
      )
      .getMany();
  }

  private choosable() {
    return this.repo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.supplier', 's')
      .where("p.status = 'ACTIVE'")
      .andWhere("s.partnershipStatus = 'ACTIVE'");
  }

  /** Chỉ `block_code`, `category_id` của các sản phẩm có `block_code` trong danh sách. */
  findByBlockCodes(blockCodes: readonly string[]): Promise<Product[]> {
    if (!blockCodes.length) return Promise.resolve([]);
    return this.repo.find({
      where: { blockCode: In([...blockCodes]) },
      select: { id: true, blockCode: true, categoryId: true },
    });
  }

  /** Số thứ tự lớn nhất trong các `block_code` dạng `<prefix>-<số>`; chưa có → 0. */
  async findLastBlockCodeSeq(prefix: string): Promise<number> {
    const rows: { seq: number | null }[] = await this.tx.manager.query(
      `SELECT max(substring(block_code FROM length($1) + 2)::int) AS seq
       FROM products
       WHERE left(block_code, length($1) + 1) = $1 || '-'
         AND substring(block_code FROM length($1) + 2) ~ '^[0-9]+$'`,
      [prefix],
    );
    return rows[0]?.seq ?? 0;
  }

  /** Chỉ ghi khóa file (`thumbnail_url`, `model_3d_url`) và `updated_at`. */
  async saveFileKeys(product: Product): Promise<void> {
    await this.repo.update(
      { id: product.id },
      { thumbnailKey: product.thumbnailKey, model3dKey: product.model3dKey },
    );
  }

  async search(
    filter: ProductSearchFilter,
    page: PageRequest,
  ): Promise<Paginated<Product>> {
    const qb = this.repo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.category', 'c')
      .innerJoinAndSelect('p.supplier', 's')
      .leftJoinAndSelect('p.styles', 'ps')
      .leftJoinAndSelect('ps.style', 'st');
    if (filter.supplierId !== undefined) {
      qb.andWhere('p.supplierId = :supplierId', {
        supplierId: filter.supplierId,
      });
    }
    if (filter.keyword) {
      qb.andWhere('(p.name ILIKE :keyword OR p.sku ILIKE :keyword)', {
        keyword: `%${escapeLike(filter.keyword)}%`,
      });
    }
    if (filter.categoryId !== undefined) {
      qb.andWhere('p.categoryId = :categoryId', {
        categoryId: filter.categoryId,
      });
    }
    if (filter.styleId !== undefined) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM product_styles f WHERE f.product_id = p.id AND f.style_id = :styleId)',
        { styleId: filter.styleId },
      );
    }
    if (filter.minPrice !== undefined) {
      qb.andWhere('p.price >= :minPrice', { minPrice: filter.minPrice });
    }
    if (filter.maxPrice !== undefined) {
      qb.andWhere('p.price <= :maxPrice', { maxPrice: filter.maxPrice });
    }
    if (filter.stockStatus !== undefined) {
      qb.andWhere('p.stockStatus = :stockStatus', {
        stockStatus: filter.stockStatus,
      });
    }
    if (filter.status !== undefined) {
      qb.andWhere('p.status = :status', { status: filter.status });
    }
    if (filter.visibleToBuyers) {
      qb.andWhere("p.status = 'ACTIVE'").andWhere(
        "s.partnershipStatus = 'ACTIVE'",
      );
    }
    const [items, total] = await qb
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((page.page - 1) * page.limit)
      .take(page.limit)
      .getManyAndCount();
    return { items, page: page.page, limit: page.limit, total };
  }

  /**
   * Tạo hoặc lưu sản phẩm. Trùng sku → `null`.
   * `styleIds` có mặt thì thay toàn bộ `product_styles`; `undefined` thì không đụng tới bảng này.
   */
  async saveIfSkuAvailable(
    product: Product,
    styleIds?: readonly string[],
  ): Promise<Product | null> {
    const loadedStyles = product.styles;
    product.styles = undefined; // không để TypeORM tự đồng bộ quan hệ OneToMany đã nạp
    let saved: Product;
    try {
      saved = await this.repo.save(product);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_products_supplier_id_sku')) return null;
      throw error;
    } finally {
      product.styles = loadedStyles;
    }
    if (styleIds !== undefined) {
      await this.replaceStyles(saved.id, styleIds);
    }
    return saved;
  }

  private async replaceStyles(
    productId: string,
    styleIds: readonly string[],
  ): Promise<void> {
    const styleRepo = this.tx.manager.getRepository(ProductStyle);
    await styleRepo.delete({ productId });
    if (styleIds.length > 0) {
      await styleRepo.insert(
        styleIds.map((styleId) => ({ productId, styleId })),
      );
    }
  }
}
