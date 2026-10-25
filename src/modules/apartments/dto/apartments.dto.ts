import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import { normalizeEmail, trim } from '../../../common/validation/transforms.js';
import { ROOM_TYPES, type RoomType } from '../entities/room.entity.js';

/** Diện tích tối đa theo NUMERIC(8,2). */
const MAX_AREA = 999999;

export class ListApartmentsQueryDto extends PaginationQueryDto {
  /** Tìm theo tên chung cư, địa chỉ hoặc mã căn */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Chỉ Staff/Admin: lọc theo chủ căn (Customer luôn chỉ thấy căn của mình) */
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class CreateApartmentDto {
  /**
   * Email customer đã tự đăng ký và ACTIVE. Bắt buộc với Staff/Admin; Customer không được gửi (→ 400).
   * Không nhận `null`.
   * @example customer@fa26se095.local
   */
  @IsOptionalNotNull()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  ownerEmail?: string;

  /** Tên chung cư / dự án @example Vinhomes Grand Park */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  buildingName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address: string;

  /** Tòa / block @example S1.02 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  tower?: string;

  /** Mã căn @example S1.02-1205 */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitNo: string;

  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floorNo?: number;

  /** Mã layout theo chủ đầu tư @example 2PN-A1 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  layoutCode?: string;

  /** Diện tích thông thủy (m²), > 0, tối đa 2 chữ số thập phân @example 65.5 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_AREA)
  netArea: number;

  @IsInt()
  @Min(0)
  @Max(20)
  bedroomCount: number;

  @IsInt()
  @Min(0)
  @Max(20)
  bathroomCount: number;
}

/** PATCH: bỏ field = giữ nguyên; `null` chỉ cho field không bắt buộc. Không đổi chủ căn. */
export class UpdateApartmentDto {
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  buildingName?: string;

  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  tower?: string | null;

  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitNo?: string;

  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floorNo?: number | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  layoutCode?: string | null;

  @IsOptionalNotNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_AREA)
  netArea?: number;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(20)
  bedroomCount?: number;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(20)
  bathroomCount?: number;
}

export class CreateRoomDto {
  /** @example Phòng ngủ master */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsIn(ROOM_TYPES)
  roomType: RoomType;

  /** Diện tích (m²), > 0 */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_AREA)
  area?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  purpose?: string;
}
