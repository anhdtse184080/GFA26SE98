import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import { CatalogService } from './catalog.service.js';
import {
  AdminListCategoriesQueryDto,
  CreateCategoryDto,
  CreateProductDto,
  ListCategoriesQueryDto,
  ListProductsQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/catalog.dto.js';
import {
  AdminCategoryPageResponseDto,
  AdminCategoryResponseDto,
  CategoryResponseDto,
  ProductPageResponseDto,
  ProductResponseDto,
} from './dto/catalog.response.dto.js';

/**
 * `/product-categories` (Supplier quản lý danh mục của mình), `/admin/product-categories` (Admin xem danh mục mọi supplier),
 * `/products` (Supplier quản lý sản phẩm của mình; Designer/Staff/Admin xem).
 * Không có DELETE: danh mục ẩn bằng `isActive`, sản phẩm ngừng bán bằng `status: INACTIVE`.
 */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ---------- Supplier ----------

  /** Danh mục của supplier đang đăng nhập, danh sách phẳng kèm `parentId` (FE tự dựng cây). */
  @Roles('SUPPLIER')
  @Get('product-categories')
  async listOwn(
    @Query() query: ListCategoriesQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.catalog.listOwnCategories(
      actor,
      query.isActive,
    );
    return categories.map((c) => CategoryResponseDto.from(c));
  }

  /** Chi tiết một danh mục của mình (danh mục của supplier khác → 404). */
  @Roles('SUPPLIER')
  @Get('product-categories/:id')
  async detailOwn(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.from(await this.catalog.getCategory(id, actor));
  }

  /** Tạo danh mục (gốc hoặc con) trong catalog của mình. Trùng `code` → 409 CATEGORY_CODE_EXISTS. */
  @Roles('SUPPLIER')
  @Post('product-categories')
  async create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CategoryResponseDto> {
    const category = await this.catalog.createCategory(actor, {
      parentId: dto.parentId ?? null,
      code: dto.code,
      name: dto.name,
      isActive: dto.isActive ?? true,
    });
    return CategoryResponseDto.from(category);
  }

  /** Đổi tên, danh mục cha (cùng catalog, không tạo vòng → 422 CATEGORY_CYCLE); `isActive: false` để ẩn. */
  @Roles('SUPPLIER')
  @Patch('product-categories/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CategoryResponseDto> {
    const category = await this.catalog.updateCategory(id, actor, {
      parentId: dto.parentId,
      name: dto.name,
      isActive: dto.isActive,
    });
    return CategoryResponseDto.from(category);
  }

  // ---------- Admin ----------

  /** Danh mục của mọi supplier (kèm supplier sở hữu), lọc theo supplier, trạng thái, từ khóa; có phân trang. */
  @Roles('ADMIN')
  @Get('admin/product-categories')
  async adminList(
    @Query() query: AdminListCategoriesQueryDto,
  ): Promise<AdminCategoryPageResponseDto> {
    const page = await this.catalog.searchCategories(
      {
        supplierId: query.supplierId,
        isActive: query.isActive,
        keyword: query.q,
      },
      { page: query.page, limit: query.limit },
    );
    return AdminCategoryPageResponseDto.from(page);
  }

  @Roles('ADMIN')
  @Get('admin/product-categories/:id')
  async adminDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdminCategoryResponseDto> {
    return AdminCategoryResponseDto.from(
      await this.catalog.getCategory(id, actor),
    );
  }

  // ---------- Products ----------

  /**
   * Supplier: sản phẩm của mình (mọi status). Designer/Staff: chỉ ACTIVE của supplier đang hợp tác.
   * Admin: tất cả, lọc được theo `supplierId`. `minPrice > maxPrice` → 422 INVALID_PRICE_RANGE.
   */
  @Roles('SUPPLIER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('products')
  async listProducts(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductPageResponseDto> {
    const page = await this.catalog.searchProducts(actor, {
      keyword: query.q,
      categoryId: query.categoryId,
      styleId: query.styleId,
      supplierId: query.supplierId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      stockStatus: query.stockStatus,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return ProductPageResponseDto.from(page);
  }

  /** Sản phẩm không được xem (của supplier khác, INACTIVE với Designer/Staff…) → 404. */
  @Roles('SUPPLIER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('products/:id')
  async productDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(await this.catalog.getProduct(id, actor));
  }

  /** Tạo sản phẩm trong catalog của mình. Trùng `sku` → 409 PRODUCT_SKU_EXISTS. */
  @Roles('SUPPLIER')
  @Post('products')
  async createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    const product = await this.catalog.createProduct(actor, {
      categoryId: dto.categoryId,
      sku: dto.sku,
      name: dto.name,
      description: dto.description ?? null,
      brand: dto.brand ?? null,
      material: dto.material ?? null,
      colorName: dto.colorName ?? null,
      colorCode: dto.colorCode ?? null,
      widthMm: dto.widthMm ?? null,
      depthMm: dto.depthMm ?? null,
      heightMm: dto.heightMm ?? null,
      unit: dto.unit,
      price: dto.price,
      stockStatus: dto.stockStatus,
      thumbnailUrl: dto.thumbnailUrl ?? null,
      model3dUrl: dto.model3dUrl ?? null,
      specifications: dto.specifications ?? null,
      styleIds: dto.styleIds ?? [],
      status: dto.status ?? 'ACTIVE',
    });
    return ProductResponseDto.from(product);
  }

  /** Sửa sản phẩm của mình (của supplier khác → 404); `styleIds` thay toàn bộ; `status: INACTIVE` = ngừng bán. */
  @Roles('SUPPLIER')
  @Patch('products/:id')
  async updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(
      await this.catalog.updateProduct(id, actor, dto),
    );
  }
}
