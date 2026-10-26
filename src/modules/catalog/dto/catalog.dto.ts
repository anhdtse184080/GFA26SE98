import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  toBoolean,
  trim,
  trimUpperCase,
} from '../../../common/validation/transforms.js';
import {
  COST_CATEGORIES,
  type CostCategory,
} from '../entities/product-category.entity.js';

/** `code` + `-NNNN` (block_code của sản phẩm) phải vừa `products.block_code` VARCHAR(50). */
const CATEGORY_CODE_MAX_LENGTH = 44;

export class AdminListCategoriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  /** Tìm theo mã hoặc tên danh mục */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateCategoryDto {
  /** Danh mục cha; bỏ trống = danh mục gốc */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  /**
   * Mã duy nhất toàn hệ thống (tự viết hoa), không đổi được về sau; là tiền tố `blockCode` của sản phẩm
   * @example SOFA
   */
  @Transform(trimUpperCase)
  @IsString()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @MaxLength(CATEGORY_CODE_MAX_LENGTH)
  code: string;

  /** @example Sofa */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  /** Mặc định true */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Model minh họa (.glb) khi món chưa có sản phẩm thật
   * @example /models/placeholders/ph-sofa.glb
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  defaultModelUrl?: string;

  /** Nhóm dự toán */
  @IsOptional()
  @IsIn(COST_CATEGORIES)
  costCategory?: CostCategory;
}

/** PATCH: bỏ field = giữ nguyên. `null` = xóa (parentId: thành danh mục gốc). Không đổi `code`. */
export class UpdateCategoryDto {
  /** Không được là chính nó hoặc danh mục con cháu của nó (→ 422 CATEGORY_CYCLE) */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  /** @example Sofa */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  /** false = ẩn (thay cho xóa) */
  @IsOptionalNotNull()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  defaultModelUrl?: string | null;

  @IsOptional()
  @IsIn(COST_CATEGORIES)
  costCategory?: CostCategory | null;
}
