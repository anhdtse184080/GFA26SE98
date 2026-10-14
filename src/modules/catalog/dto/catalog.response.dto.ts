import type { Paginated } from '../../../common/pagination/paginated.js';
import type { ProductCategory } from '../entities/product-category.entity.js';
import type {
  Product,
  ProductStatus,
  ProductUnit,
  StockStatus,
} from '../entities/product.entity.js';

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

// ---------- Products ----------

export class ProductCategoryRefDto {
  id: string;
  code: string;
  name: string;
}

export class ProductStyleRefDto {
  id: string;
  code: string;
  name: string;
}

export class ProductResponseDto {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  material: string | null;
  colorName: string | null;
  colorCode: string | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  unit: ProductUnit;
  /** VND, dạng string 2 chữ số thập phân (vd "15900000.00") */
  price: string;
  stockStatus: StockStatus;
  thumbnailUrl: string | null;
  model3dUrl: string | null;
  specifications: Record<string, unknown> | null;
  status: ProductStatus;
  priceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: ProductCategoryRefDto;
  supplier: CategorySupplierDto;
  styles: ProductStyleRefDto[];

  /** `product` phải được tải kèm `category`, `supplier`, `styles.style`. */
  static from(product: Product): ProductResponseDto {
    const { category, supplier, styles } = product;
    if (!category || !supplier || !styles) {
      throw new Error('Product must be loaded with category, supplier, styles');
    }
    return Object.assign(new ProductResponseDto(), {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      brand: product.brand,
      material: product.material,
      colorName: product.colorName,
      colorCode: product.colorCode,
      widthMm: product.widthMm,
      depthMm: product.depthMm,
      heightMm: product.heightMm,
      unit: product.unit,
      price: product.price,
      stockStatus: product.stockStatus,
      thumbnailUrl: product.thumbnailUrl,
      model3dUrl: product.model3dUrl,
      specifications: product.specifications,
      status: product.status,
      priceUpdatedAt: product.priceUpdatedAt,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      category: { id: category.id, code: category.code, name: category.name },
      supplier: { id: supplier.userId, companyName: supplier.companyName },
      styles: styles
        .flatMap((ps) => (ps.style ? [ps.style] : []))
        .map((s) => ({ id: s.id, code: s.code, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
}

export class ProductPageResponseDto {
  items: ProductResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(page: Paginated<Product>): ProductPageResponseDto {
    return Object.assign(new ProductPageResponseDto(), {
      items: page.items.map((p) => ProductResponseDto.from(p)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
