import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { DesignStylesService } from '../design-styles/design-styles.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  ProductCategory,
  ProductCategoryPatch,
} from './entities/product-category.entity.js';
import {
  Product,
  type ProductPatch,
  type ProductStatus,
  type StockStatus,
} from './entities/product.entity.js';
import {
  type CategorySearchFilter,
  type NewProductCategory,
  ProductCategoriesRepository,
} from './product-categories.repository.js';
import { ProductsRepository } from './products.repository.js';

export type CreateCategoryInput = Omit<NewProductCategory, 'supplierId'>;

export interface UpdateCategoryInput extends ProductCategoryPatch {
  /** `undefined` = giữ nguyên, `null` = thành danh mục gốc. */
  parentId?: string | null;
}

export interface SearchProductsInput extends PageRequest {
  keyword?: string;
  categoryId?: string;
  styleId?: string;
  /** Chỉ có tác dụng với Admin/Designer/Staff; Supplier luôn bị giới hạn về sản phẩm của mình. */
  supplierId?: string;
  minPrice?: string;
  maxPrice?: string;
  stockStatus?: StockStatus;
  status?: ProductStatus;
}

/** Field nullable đã được controller chuẩn hóa `undefined` → `null`. `price` là chuỗi thập phân > 0. */
export type CreateProductInput = Required<ProductPatch> & {
  categoryId: string;
  price: string;
  styleIds: string[];
};

/** `undefined` = giữ nguyên. `styleIds` có mặt thì thay toàn bộ phong cách. */
export type UpdateProductInput = ProductPatch & {
  categoryId?: string;
  price?: string;
  styleIds?: string[];
};

/**
 * Catalog **riêng của từng supplier**:
 * - Danh mục dạng cây: Supplier tạo/sửa/ẩn và xem của mình; Admin xem của mọi supplier. Không xóa: ẩn bằng `is_active`.
 * - Sản phẩm: Supplier tạo/sửa/xem của mình (mọi status); Designer/Staff chỉ xem sản phẩm ACTIVE của supplier
 *   đang hợp tác (chọn đồ ở Core Flow 4); Admin xem tất cả. Không xóa: ngừng bán bằng `status = INACTIVE`.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly categories: ProductCategoriesRepository,
    private readonly products: ProductsRepository,
    private readonly users: UsersService,
    private readonly styles: DesignStylesService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------- Danh mục ----------

  /** Danh mục của supplier đang đăng nhập (phẳng, kèm `parentId`). */
  listOwnCategories(
    actor: AuthUser,
    isActive?: boolean,
  ): Promise<ProductCategory[]> {
    return this.categories.findAllBySupplier(actor.id, isActive);
  }

  /** Admin: danh mục của mọi supplier, lọc theo supplier/trạng thái/từ khóa, có phân trang. */
  searchCategories(
    filter: CategorySearchFilter,
    page: PageRequest,
  ): Promise<Paginated<ProductCategory>> {
    return this.categories.search(filter, page);
  }

  /**
   * SUPPLIER chỉ xem danh mục của mình; ADMIN xem tất cả.
   * @throws NotFoundError `CATEGORY_NOT_FOUND` (cả khi không phải danh mục của supplier)
   */
  async getCategory(id: string, actor: AuthUser): Promise<ProductCategory> {
    const category = await this.getCategoryOrThrow(id);
    if (actor.role !== 'ADMIN' && category.supplierId !== actor.id) {
      throw this.categoryNotFound(id);
    }
    return category;
  }

  /**
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE`
   * @throws NotFoundError `CATEGORY_NOT_FOUND` (danh mục cha không có hoặc của supplier khác)
   * @throws ConflictError `CATEGORY_CODE_EXISTS`
   */
  async createCategory(
    actor: AuthUser,
    input: CreateCategoryInput,
  ): Promise<ProductCategory> {
    const id = await this.uow.run(async () => {
      const supplierId = await this.getActiveSupplierId(actor);
      if (input.parentId !== null) {
        await this.getOwnCategory(input.parentId, supplierId);
      }
      const category = await this.categories.createIfCodeAvailable({
        ...input,
        supplierId,
      });
      if (!category) {
        throw new ConflictError(
          'CATEGORY_CODE_EXISTS',
          'Mã danh mục đã tồn tại trong catalog của bạn',
          { code: input.code },
        );
      }
      return category.id;
    });
    return this.getCategoryOrThrow(id);
  }

  /**
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `CATEGORY_CYCLE`
   * @throws NotFoundError `CATEGORY_NOT_FOUND`
   */
  async updateCategory(
    id: string,
    actor: AuthUser,
    input: UpdateCategoryInput,
  ): Promise<ProductCategory> {
    return this.uow.run(async () => {
      const supplierId = await this.getActiveSupplierId(actor);
      const category = await this.getOwnCategory(id, supplierId);
      if (input.parentId !== undefined) {
        if (input.parentId !== null) {
          await this.getOwnCategory(input.parentId, supplierId);
          await this.assertNoCycle(id, input.parentId);
        }
        category.moveTo(input.parentId);
      }
      category.update({ name: input.name, isActive: input.isActive });
      return this.categories.save(category);
    });
  }

  // ---------- Sản phẩm ----------

  /**
   * Supplier: chỉ sản phẩm của mình (mọi status). Designer/Staff: chỉ ACTIVE của supplier đang hợp tác.
   * Admin: tất cả.
   * @throws BusinessRuleError `INVALID_PRICE_RANGE`
   */
  searchProducts(
    actor: AuthUser,
    input: SearchProductsInput,
  ): Promise<Paginated<Product>> {
    const { page, limit, ...filter } = input;
    if (
      filter.minPrice !== undefined &&
      filter.maxPrice !== undefined &&
      new Decimal(filter.minPrice).greaterThan(filter.maxPrice)
    ) {
      throw new BusinessRuleError(
        'INVALID_PRICE_RANGE',
        'minPrice không được lớn hơn maxPrice',
        { minPrice: filter.minPrice, maxPrice: filter.maxPrice },
      );
    }
    return this.products.search(
      {
        ...filter,
        keyword: filter.keyword || undefined,
        supplierId: actor.role === 'SUPPLIER' ? actor.id : filter.supplierId,
        visibleToBuyers: actor.role === 'DESIGNER' || actor.role === 'STAFF',
      },
      { page, limit },
    );
  }

  /** @throws NotFoundError `PRODUCT_NOT_FOUND` (cả khi actor không được xem sản phẩm này) */
  async getProduct(id: string, actor: AuthUser): Promise<Product> {
    const product = await this.getProductOrThrow(id);
    if (!this.canViewProduct(product, actor)) throw this.productNotFound(id);
    return product;
  }

  /**
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `CATEGORY_INACTIVE` | `DESIGN_STYLE_INACTIVE`
   * @throws NotFoundError `CATEGORY_NOT_FOUND` | `DESIGN_STYLE_NOT_FOUND`
   * @throws ConflictError `PRODUCT_SKU_EXISTS`
   */
  async createProduct(
    actor: AuthUser,
    input: CreateProductInput,
  ): Promise<Product> {
    const id = await this.uow.run(async () => {
      const supplierId = await this.getActiveSupplierId(actor);
      const { categoryId, price, styleIds, ...fields } = input;
      await this.assertUsableCategory(categoryId, supplierId);
      await this.assertActiveStyles(styleIds);
      const product = Object.assign(new Product(), fields, {
        supplierId,
        categoryId,
      });
      product.changePrice(new Decimal(price), this.clock.now());
      const saved = await this.products.saveIfSkuAvailable(product, styleIds);
      if (!saved) throw this.skuTaken(fields.sku);
      return saved.id;
    });
    return this.getProductOrThrow(id);
  }

  /**
   * Chỉ sửa sản phẩm của mình (của supplier khác → 404). Đổi giá → cập nhật `price_updated_at`.
   * Chỉ khi có `styleIds` mới thay toàn bộ `product_styles`.
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `CATEGORY_INACTIVE` | `DESIGN_STYLE_INACTIVE`
   * @throws NotFoundError `PRODUCT_NOT_FOUND` | `CATEGORY_NOT_FOUND` | `DESIGN_STYLE_NOT_FOUND`
   * @throws ConflictError `PRODUCT_SKU_EXISTS`
   */
  async updateProduct(
    id: string,
    actor: AuthUser,
    input: UpdateProductInput,
  ): Promise<Product> {
    await this.uow.run(async () => {
      const supplierId = await this.getActiveSupplierId(actor);
      const product = await this.getProductOrThrow(id);
      if (product.supplierId !== supplierId) throw this.productNotFound(id);

      const { categoryId, price, styleIds, ...patch } = input;
      if (categoryId !== undefined && categoryId !== product.categoryId) {
        await this.assertUsableCategory(categoryId, supplierId);
        product.moveToCategory(categoryId);
      }
      if (styleIds !== undefined) await this.assertActiveStyles(styleIds);
      if (price !== undefined) {
        product.changePrice(new Decimal(price), this.clock.now());
      }
      product.update(patch);
      // styleIds không gửi → undefined → repository không đụng tới product_styles
      const saved = await this.products.saveIfSkuAvailable(product, styleIds);
      if (!saved) throw this.skuTaken(patch.sku);
    });
    return this.getProductOrThrow(id);
  }

  // ---------- Private ----------

  private async getProductOrThrow(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw this.productNotFound(id);
    return product;
  }

  private productNotFound(id: string): NotFoundError {
    return new NotFoundError('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm', {
      productId: id,
    });
  }

  private skuTaken(sku: string | undefined): ConflictError {
    return new ConflictError(
      'PRODUCT_SKU_EXISTS',
      'Mã SKU đã tồn tại trong catalog của bạn',
      { sku },
    );
  }

  private canViewProduct(product: Product, actor: AuthUser): boolean {
    switch (actor.role) {
      case 'ADMIN':
        return true;
      case 'SUPPLIER':
        return product.supplierId === actor.id;
      case 'DESIGNER':
      case 'STAFF':
        return product.isVisibleToBuyers();
      default:
        return false;
    }
  }

  /**
   * Danh mục của sản phẩm phải thuộc catalog của supplier và đang hoạt động.
   * @throws NotFoundError `CATEGORY_NOT_FOUND`
   * @throws BusinessRuleError `CATEGORY_INACTIVE`
   */
  private async assertUsableCategory(
    categoryId: string,
    supplierId: string,
  ): Promise<void> {
    const category = await this.getOwnCategory(categoryId, supplierId);
    if (!category.isActive) {
      throw new BusinessRuleError(
        'CATEGORY_INACTIVE',
        'Danh mục sản phẩm đang bị ẩn',
        { categoryId },
      );
    }
  }

  /**
   * @throws NotFoundError `DESIGN_STYLE_NOT_FOUND`
   * @throws BusinessRuleError `DESIGN_STYLE_INACTIVE`
   */
  private async assertActiveStyles(styleIds: readonly string[]): Promise<void> {
    const found = await this.styles.findByIds(styleIds);
    const foundIds = new Set(found.map((s) => s.id));
    const missing = styleIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError(
        'DESIGN_STYLE_NOT_FOUND',
        'Không tìm thấy phong cách thiết kế',
        { styleIds: missing },
      );
    }
    const inactive = found.filter((s) => !s.isActive).map((s) => s.id);
    if (inactive.length > 0) {
      throw new BusinessRuleError(
        'DESIGN_STYLE_INACTIVE',
        'Phong cách thiết kế đang bị ẩn',
        { styleIds: inactive },
      );
    }
  }

  private async getCategoryOrThrow(id: string): Promise<ProductCategory> {
    const category = await this.categories.findById(id);
    if (!category) throw this.categoryNotFound(id);
    return category;
  }

  /** @throws NotFoundError `CATEGORY_NOT_FOUND` (không có hoặc của supplier khác) */
  private async getOwnCategory(
    id: string,
    supplierId: string,
  ): Promise<ProductCategory> {
    const category = await this.getCategoryOrThrow(id);
    if (category.supplierId !== supplierId) throw this.categoryNotFound(id);
    return category;
  }

  private categoryNotFound(id: string): NotFoundError {
    return new NotFoundError(
      'CATEGORY_NOT_FOUND',
      'Không tìm thấy danh mục sản phẩm',
      { categoryId: id },
    );
  }

  /**
   * Danh mục cha mới không được là chính nó hoặc con cháu của nó.
   * @throws BusinessRuleError `CATEGORY_CYCLE`
   */
  private async assertNoCycle(id: string, parentId: string): Promise<void> {
    const chain = await this.categories.findSelfAndAncestorIds(parentId);
    if (chain.includes(id)) {
      throw new BusinessRuleError(
        'CATEGORY_CYCLE',
        'Danh mục cha không được là chính nó hoặc danh mục con của nó',
        { categoryId: id, parentId },
      );
    }
  }

  /**
   * Supplier đang hợp tác (`partnership_status = ACTIVE`) mới được ghi catalog. `users.status` do JwtAuthGuard kiểm tra.
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE`
   */
  private async getActiveSupplierId(actor: AuthUser): Promise<string> {
    const profile = (await this.users.getWithProfiles(actor.id))
      .supplierProfile;
    if (!profile) {
      throw new ForbiddenError(
        'SUPPLIER_PROFILE_MISSING',
        'Tài khoản không có hồ sơ nhà cung cấp',
      );
    }
    if (profile.partnershipStatus !== 'ACTIVE') {
      throw new BusinessRuleError(
        'SUPPLIER_NOT_ACTIVE',
        'Nhà cung cấp không còn trong trạng thái hợp tác',
        { partnershipStatus: profile.partnershipStatus },
      );
    }
    return profile.userId;
  }
}
