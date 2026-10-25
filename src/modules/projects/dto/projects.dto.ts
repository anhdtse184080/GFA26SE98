import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import { trim } from '../../../common/validation/transforms.js';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../entities/project.entity.js';

/** Tiền > 0, tối đa 13 chữ số phần nguyên và 2 chữ số thập phân (NUMERIC(15,2)). */
const POSITIVE_MONEY_PATTERN = /^(?!0+(\.0{1,2})?$)\d{1,13}(\.\d{1,2})?$/;
const MONEY_MESSAGE =
  'phải > 0, tối đa 13 chữ số phần nguyên và 2 chữ số thập phân';

/** Tiền nhận string (khuyến nghị, giữ chính xác) hoặc number; regex kiểm tra sau. */
const toMoneyString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : trim({ value });

export class ListProjectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  /** Tìm theo mã hoặc tiêu đề dự án */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateProjectDto {
  /** Căn hộ của customer; customer của dự án = chủ căn hộ */
  @IsUUID()
  apartmentId: string;

  /** @example Thiết kế nội thất căn hộ 2PN Vinhomes */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description?: string;

  /** Số người ở */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  householdSize?: number;

  /** Phong cách ưa thích (phải đang active) */
  @IsOptional()
  @IsUUID()
  preferredStyleId?: string;

  /**
   * Ngân sách tối thiểu (VND), > 0
   * @example 150000000
   */
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: `budgetMin ${MONEY_MESSAGE}`,
  })
  budgetMin: string;

  /**
   * Ngân sách tối đa (VND), ≥ budgetMin
   * @example 250000000
   */
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: `budgetMax ${MONEY_MESSAGE}`,
  })
  budgetMax: string;

  /** Dung sai vượt ngân sách (%), 0–10, mặc định 10 */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  budgetTolerancePercent?: number;
}

/** PATCH (chỉ khi DRAFT): bỏ field = giữ nguyên; `null` chỉ cho field không bắt buộc. Không đổi căn hộ/customer/staff. */
export class UpdateProjectDto {
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  householdSize?: number | null;

  @IsOptional()
  @IsUUID()
  preferredStyleId?: string | null;

  @IsOptionalNotNull()
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: `budgetMin ${MONEY_MESSAGE}`,
  })
  budgetMin?: string;

  @IsOptionalNotNull()
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: `budgetMax ${MONEY_MESSAGE}`,
  })
  budgetMax?: string;

  @IsOptionalNotNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  budgetTolerancePercent?: number;
}
