import { Injectable } from '@nestjs/common';
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
import { UnitOfWork } from '../../database/unit-of-work.js';
import { UsersService } from '../users/users.service.js';
import type {
  ProductCategory,
  ProductCategoryPatch,
} from './entities/product-category.entity.js';
import {
  type CategorySearchFilter,
  type NewProductCategory,
  ProductCategoriesRepository,
} from './product-categories.repository.js';

export type CreateCategoryInput = Omit<NewProductCategory, 'supplierId'>;

export interface UpdateCategoryInput extends ProductCategoryPatch {
  /** `undefined` = giữ nguyên, `null` = thành danh mục gốc. */
  parentId?: string | null;
}

/**
 * Danh mục sản phẩm dạng cây, **riêng của từng supplier**: Supplier tạo/sửa/ẩn và xem của mình;
 * Admin xem của mọi supplier. Không xóa: ẩn bằng `is_active`.
 * Module `products` dùng `getActiveSupplierId`, `assertUsableCategory` khi ghi sản phẩm.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly categories: ProductCategoriesRepository,
    private readonly users: UsersService,
    private readonly uow: UnitOfWork,
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

  // ---------- Dùng chung với module products ----------

  /**
   * Supplier đang hợp tác (`partnership_status = ACTIVE`) mới được ghi catalog (danh mục, sản phẩm). `users.status` do JwtAuthGuard kiểm tra.
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE`
   */
  async getActiveSupplierId(actor: AuthUser): Promise<string> {
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

  /**
   * Danh mục của sản phẩm phải thuộc catalog của supplier và đang hoạt động.
   * @throws NotFoundError `CATEGORY_NOT_FOUND`
   * @throws BusinessRuleError `CATEGORY_INACTIVE`
   */
  async assertUsableCategory(
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

  // ---------- Private ----------

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
}
