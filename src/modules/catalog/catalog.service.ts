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

export type CreateCategoryInput = NewProductCategory;

export interface UpdateCategoryInput extends ProductCategoryPatch {
  /** `undefined` = giữ nguyên, `null` = thành danh mục gốc. */
  parentId?: string | null;
}

/**
 * Danh mục sản phẩm **dùng chung** dạng cây: chỉ Admin tạo/sửa/ẩn; Supplier, Designer, Staff xem danh mục
 * đang hoạt động để chọn. Không xóa: ẩn bằng `is_active`.
 * Module `products` dùng `getActiveSupplierId`, `getUsableCategoryForUpdate` khi ghi sản phẩm.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly categories: ProductCategoriesRepository,
    private readonly users: UsersService,
    private readonly uow: UnitOfWork,
  ) {}

  // ---------- Danh mục ----------

  /** Danh mục đang hoạt động (phẳng, kèm `parentId`), để chọn khi tạo sản phẩm / đổi mẫu. */
  listActiveCategories(): Promise<ProductCategory[]> {
    return this.categories.findAll(true);
  }

  /** Admin: mọi danh mục, lọc theo trạng thái/từ khóa, có phân trang. */
  searchCategories(
    filter: CategorySearchFilter,
    page: PageRequest,
  ): Promise<Paginated<ProductCategory>> {
    return this.categories.search(filter, page);
  }

  /** @throws NotFoundError `CATEGORY_NOT_FOUND` */
  getCategory(id: string): Promise<ProductCategory> {
    return this.getCategoryOrThrow(id);
  }

  /**
   * @throws NotFoundError `CATEGORY_NOT_FOUND` (danh mục cha không có)
   * @throws ConflictError `CATEGORY_CODE_EXISTS`
   */
  async createCategory(input: CreateCategoryInput): Promise<ProductCategory> {
    return this.uow.run(async () => {
      if (input.parentId !== null) {
        await this.getCategoryOrThrow(input.parentId);
      }
      const category = await this.categories.createIfCodeAvailable(input);
      if (!category) {
        throw new ConflictError(
          'CATEGORY_CODE_EXISTS',
          'Mã danh mục đã tồn tại',
          { code: input.code },
        );
      }
      return category;
    });
  }

  /**
   * @throws BusinessRuleError `CATEGORY_CYCLE`
   * @throws NotFoundError `CATEGORY_NOT_FOUND`
   */
  async updateCategory(
    id: string,
    input: UpdateCategoryInput,
  ): Promise<ProductCategory> {
    return this.uow.run(async () => {
      const category = await this.getCategoryOrThrow(id);
      const { parentId, ...patch } = input;
      if (parentId !== undefined) {
        if (parentId !== null) {
          await this.getCategoryOrThrow(parentId);
          await this.assertNoCycle(id, parentId);
        }
        category.moveTo(parentId);
      }
      category.update(patch);
      return this.categories.save(category);
    });
  }

  // ---------- Dùng chung với module products ----------

  /**
   * Supplier đang hợp tác (`partnership_status = ACTIVE`) mới được ghi sản phẩm. `users.status` do JwtAuthGuard kiểm tra.
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
   * Danh mục của sản phẩm phải tồn tại và đang hoạt động. Khóa dòng danh mục đến hết transaction
   * (gọi bên trong `UnitOfWork.run`) để đánh số `block_code` tuần tự.
   * @throws NotFoundError `CATEGORY_NOT_FOUND`
   * @throws BusinessRuleError `CATEGORY_INACTIVE`
   */
  async getUsableCategoryForUpdate(
    categoryId: string,
  ): Promise<ProductCategory> {
    const category = await this.categories.findByIdForUpdate(categoryId);
    if (!category) throw this.categoryNotFound(categoryId);
    if (!category.isActive) {
      throw new BusinessRuleError(
        'CATEGORY_INACTIVE',
        'Danh mục sản phẩm đang bị ẩn',
        { categoryId },
      );
    }
    return category;
  }

  // ---------- Private ----------

  private async getCategoryOrThrow(id: string): Promise<ProductCategory> {
    const category = await this.categories.findById(id);
    if (!category) throw this.categoryNotFound(id);
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
