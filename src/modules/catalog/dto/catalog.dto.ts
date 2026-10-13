import { Transform } from 'class-transformer';
import {
  IsBoolean,
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

export class ListCategoriesQueryDto {
  /** Lọc theo trạng thái; bỏ trống = tất cả */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/** Admin xem danh mục của mọi supplier. */
export class AdminListCategoriesQueryDto extends PaginationQueryDto {
  /** `user_id` của supplier */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

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
  /** Danh mục cha (phải thuộc catalog của bạn); bỏ trống = danh mục gốc */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  /**
   * Mã duy nhất trong catalog của bạn (tự viết hoa)
   * @example SOFA
   */
  @Transform(trimUpperCase)
  @IsString()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @MaxLength(50)
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
}

/** PATCH: bỏ field = giữ nguyên. `parentId: null` = chuyển thành danh mục gốc. Không đổi `code`. */
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
}
