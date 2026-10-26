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
import { Roles } from '../../common/auth/decorators.js';
import { CatalogService } from './catalog.service.js';
import {
  AdminListCategoriesQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/catalog.dto.js';
import {
  CategoryPageResponseDto,
  CategoryResponseDto,
} from './dto/catalog.response.dto.js';

/**
 * Danh mục sản phẩm dùng chung: `/product-categories` (Supplier/Designer/Staff xem để chọn),
 * `/admin/product-categories` (Admin tạo/sửa/ẩn). Không có DELETE: danh mục ẩn bằng `isActive`.
 */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Danh mục đang hoạt động, danh sách phẳng kèm `parentId` (FE tự dựng cây). */
  @Roles('SUPPLIER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('product-categories')
  async listActive(): Promise<CategoryResponseDto[]> {
    const categories = await this.catalog.listActiveCategories();
    return categories.map((c) => CategoryResponseDto.from(c));
  }

  // ---------- Admin ----------

  /** Mọi danh mục (kể cả đang ẩn), lọc theo trạng thái, từ khóa; có phân trang. */
  @Roles('ADMIN')
  @Get('admin/product-categories')
  async adminList(
    @Query() query: AdminListCategoriesQueryDto,
  ): Promise<CategoryPageResponseDto> {
    const page = await this.catalog.searchCategories(
      { isActive: query.isActive, keyword: query.q },
      { page: query.page, limit: query.limit },
    );
    return CategoryPageResponseDto.from(page);
  }

  @Roles('ADMIN')
  @Get('admin/product-categories/:id')
  async adminDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.from(await this.catalog.getCategory(id));
  }

  /** Tạo danh mục (gốc hoặc con). Trùng `code` → 409 CATEGORY_CODE_EXISTS. */
  @Roles('ADMIN')
  @Post('admin/product-categories')
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const category = await this.catalog.createCategory({
      parentId: dto.parentId ?? null,
      code: dto.code,
      name: dto.name,
      isActive: dto.isActive ?? true,
      defaultModelUrl: dto.defaultModelUrl ?? null,
      costCategory: dto.costCategory ?? null,
    });
    return CategoryResponseDto.from(category);
  }

  /** Đổi tên, danh mục cha (không tạo vòng → 422 CATEGORY_CYCLE), model minh họa, nhóm dự toán; `isActive: false` để ẩn. */
  @Roles('ADMIN')
  @Patch('admin/product-categories/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.catalog.updateCategory(id, {
      parentId: dto.parentId,
      name: dto.name,
      isActive: dto.isActive,
      defaultModelUrl: dto.defaultModelUrl,
      costCategory: dto.costCategory,
    });
    return CategoryResponseDto.from(category);
  }
}
