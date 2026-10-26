import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  CostCategory,
  ProductCategory,
} from '../entities/product-category.entity.js';

export class CategoryResponseDto {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  /** Model minh họa (.glb) khi món chưa có sản phẩm thật */
  defaultModelUrl: string | null;
  costCategory: CostCategory | null;

  static from(category: ProductCategory): CategoryResponseDto {
    return Object.assign(new CategoryResponseDto(), {
      id: category.id,
      parentId: category.parentId,
      code: category.code,
      name: category.name,
      isActive: category.isActive,
      defaultModelUrl: category.defaultModelUrl,
      costCategory: category.costCategory,
    });
  }
}

export class CategoryPageResponseDto {
  items: CategoryResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(page: Paginated<ProductCategory>): CategoryPageResponseDto {
    return Object.assign(new CategoryPageResponseDto(), {
      items: page.items.map((c) => CategoryResponseDto.from(c)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
