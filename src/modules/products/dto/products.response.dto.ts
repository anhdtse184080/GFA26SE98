import type { AuthUser } from '../../../common/auth/auth-user.js';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  Product,
  ProductStatus,
  ProductUnit,
  StockStatus,
} from '../entities/product.entity.js';

export class ProductCategoryRefDto {
  id: string;
  code: string;
  name: string;
}

export class ProductSupplierDto {
  /** `user_id` của supplier */
  id: string;
  companyName: string;
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
  /** Đường dẫn API tải ảnh (`/products/:id/thumbnail`, cần Bearer token); null = chưa có ảnh */
  thumbnailUrl: string | null;
  /** Đường dẫn API tải model .glb (`/products/:id/model-3d`); null = chưa có hoặc role không được xem (chỉ Supplier chủ và Designer) */
  model3dUrl: string | null;
  specifications: Record<string, unknown> | null;
  status: ProductStatus;
  priceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: ProductCategoryRefDto;
  supplier: ProductSupplierDto;
  styles: ProductStyleRefDto[];

  /** `product` phải được tải kèm `category`, `supplier`, `styles.style`. `viewer` quyết định có lộ `model3dUrl`. */
  static from(product: Product, viewer: AuthUser): ProductResponseDto {
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
      thumbnailUrl: product.thumbnailKey
        ? `/products/${product.id}/thumbnail`
        : null,
      model3dUrl:
        product.model3dKey && product.isModel3dVisibleTo(viewer)
          ? `/products/${product.id}/model-3d`
          : null,
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

  static from(
    page: Paginated<Product>,
    viewer: AuthUser,
  ): ProductPageResponseDto {
    return Object.assign(new ProductPageResponseDto(), {
      items: page.items.map((p) => ProductResponseDto.from(p, viewer)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
