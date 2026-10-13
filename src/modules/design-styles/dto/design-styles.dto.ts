import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  toBoolean,
  trim,
  trimUpperCase,
} from '../../../common/validation/transforms.js';

export class ListDesignStylesQueryDto {
  /** Lọc theo trạng thái; bỏ trống = tất cả */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDesignStyleDto {
  /**
   * Mã duy nhất (tự viết hoa)
   * @example JAPANDI
   */
  @Transform(trimUpperCase)
  @IsString()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @MaxLength(50)
  code: string;

  /** @example Japandi */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** @example Kết hợp tối giản Nhật Bản và Bắc Âu */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** @example https://cdn.example.com/styles/japandi.jpg */
  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true }, { message: 'imageUrl không hợp lệ' })
  @MaxLength(500)
  imageUrl?: string;

  /** Mặc định true */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** PATCH: bỏ field = giữ nguyên; `null` = xóa (chỉ field không bắt buộc). Không đổi `code`. */
export class UpdateDesignStyleDto {
  /** @example Japandi */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true }, { message: 'imageUrl không hợp lệ' })
  @MaxLength(500)
  imageUrl?: string | null;

  /** false = ẩn (thay cho xóa) */
  @IsOptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}
