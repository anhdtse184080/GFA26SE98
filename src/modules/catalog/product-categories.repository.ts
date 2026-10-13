import { Injectable } from '@nestjs/common';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { escapeLike } from '../../database/postgres/escape-like.js';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { ProductCategory } from './entities/product-category.entity.js';

export type NewProductCategory = Pick<
  ProductCategory,
  'supplierId' | 'parentId' | 'code' | 'name' | 'isActive'
>;

export interface CategorySearchFilter {
  supplierId?: string;
  isActive?: boolean;
  /** Tìm trong mã hoặc tên danh mục (không phân biệt hoa thường). */
  keyword?: string;
}

/**
 * `product_categories`. Không có `delete`: ẩn bằng `is_active`.
 * JOIN `supplier_profiles` chỉ để đọc (lấy `company_name`).
 */
@Injectable()
export class ProductCategoriesRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(ProductCategory);
  }

  findById(id: string): Promise<ProductCategory | null> {
    return this.repo.findOne({ where: { id }, relations: { supplier: true } });
  }

  findAllBySupplier(
    supplierId: string,
    isActive?: boolean,
  ): Promise<ProductCategory[]> {
    return this.repo.find({
      where: isActive === undefined ? { supplierId } : { supplierId, isActive },
      order: { name: 'ASC' },
    });
  }

  async search(
    filter: CategorySearchFilter,
    page: PageRequest,
  ): Promise<Paginated<ProductCategory>> {
    const qb = this.repo
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.supplier', 's');
    if (filter.supplierId !== undefined) {
      qb.andWhere('c.supplierId = :supplierId', {
        supplierId: filter.supplierId,
      });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('c.isActive = :isActive', { isActive: filter.isActive });
    }
    if (filter.keyword) {
      qb.andWhere('(c.code ILIKE :keyword OR c.name ILIKE :keyword)', {
        keyword: `%${escapeLike(filter.keyword)}%`,
      });
    }
    const [items, total] = await qb
      .orderBy('s.companyName', 'ASC')
      .addOrderBy('c.name', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .skip((page.page - 1) * page.limit)
      .take(page.limit)
      .getManyAndCount();
    return { items, page: page.page, limit: page.limit, total };
  }

  /** Id của danh mục `id` và mọi danh mục tổ tiên của nó (đi ngược `parent_id` lên gốc). */
  async findSelfAndAncestorIds(id: string): Promise<string[]> {
    const rows: { id: string }[] = await this.tx.manager.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id FROM product_categories WHERE id = $1
         UNION
         SELECT c.id, c.parent_id FROM product_categories c JOIN chain ON c.id = chain.parent_id
       )
       SELECT id FROM chain`,
      [id],
    );
    return rows.map((row) => row.id);
  }

  /** Trùng `(supplier_id, code)` → `null`. */
  async createIfCodeAvailable(
    category: NewProductCategory,
  ): Promise<ProductCategory | null> {
    try {
      return await this.repo.save(this.repo.create(category));
    } catch (error) {
      if (isUniqueViolation(error, 'uq_product_categories_supplier_id_code')) {
        return null;
      }
      throw error;
    }
  }

  save(category: ProductCategory): Promise<ProductCategory> {
    return this.repo.save(category);
  }
}
