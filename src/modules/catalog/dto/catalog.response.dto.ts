import type { Paginated } from '../../../common/pagination/paginated.js';
import type { ProductCategory } from '../entities/product-category.entity.js';

export class CategoryResponseDto {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;

  static from(category: ProductCategory): CategoryResponseDto {
    return Object.assign(new CategoryResponseDto(), {
      id: category.id,
      parentId: category.parentId,
      code: category.code,
      name: category.name,
      isActive: category.isActive,
    });
  }
}

export class CategorySupplierDto {
  /** `user_id` của supplier */
  id: string;
  companyName: string;
}

/** Danh mục kèm supplier sở hữu (Admin). */
export class AdminCategoryResponseDto extends CategoryResponseDto {
  supplier: CategorySupplierDto;

  /** `category` phải được tải kèm `supplier`. */
  static from(category: ProductCategory): AdminCategoryResponseDto {
    const supplier = category.supplier;
    if (!supplier) throw new Error('Category must be loaded with supplier');
    return Object.assign(
      new AdminCategoryResponseDto(),
      CategoryResponseDto.from(category),
      { supplier: { id: supplier.userId, companyName: supplier.companyName } },
    );
  }
}

export class AdminCategoryPageResponseDto {
  items: AdminCategoryResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(page: Paginated<ProductCategory>): AdminCategoryPageResponseDto {
    return Object.assign(new AdminCategoryPageResponseDto(), {
      items: page.items.map((c) => AdminCategoryResponseDto.from(c)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
