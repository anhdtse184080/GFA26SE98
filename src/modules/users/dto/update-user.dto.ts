import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import {
  PHONE_PATTERN,
  trim,
  trimUpperCase,
} from '../../../common/validation/transforms.js';
import { ROLE_CODES, type RoleCode } from '../role-code.enum.js';
import { USER_STATUSES, type UserStatus } from '../user-status.js';

const PHONE_MESSAGE = 'phải gồm 9–15 chữ số, có thể bắt đầu bằng +';

/** PATCH: bỏ field = giữ nguyên; `null` = xóa (chỉ field không bắt buộc). */

export class UpdateMeDesignerProfileDto {
  /** @example Kiến trúc sư */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  title?: string | null;

  /** @example Căn hộ phong cách Japandi, Scandinavian */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  specialization?: string | null;

  /** @example 5 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsOfExperience?: number | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  bio?: string | null;
}

export class AdminUpdateDesignerProfileDto extends UpdateMeDesignerProfileDto {
  /** @example NV001 */
  @IsOptionalNotNull()
  @Transform(trimUpperCase)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  employeeCode?: string;
}

/** Supplier tự sửa: thông tin công ty và liên hệ, không sửa mã số thuế. */
export class UpdateMeSupplierProfileDto {
  /** @example Công ty TNHH Nội thất ABC */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  companyName?: string;

  /** @example 123 Nguyễn Văn Linh, Quận 7, TP.HCM */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  businessAddress?: string;

  /** @example Trần Thị B */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  contactName?: string | null;

  /** @example 0281234567 */
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE_PATTERN, { message: `contactPhone ${PHONE_MESSAGE}` })
  contactPhone?: string | null;

  /** @example https://abc-noithat.vn */
  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true }, { message: 'website không hợp lệ' })
  @MaxLength(255)
  website?: string | null;
}

export class AdminUpdateSupplierProfileDto extends UpdateMeSupplierProfileDto {
  /** @example 0312345678 */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @Matches(/^\d{10}(-\d{3})?$/, {
    message: 'taxCode phải gồm 10 chữ số, có thể thêm -xxx (chi nhánh)',
  })
  taxCode?: string;

  /** @example 2026-01-15 */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'partnerSince phải có dạng YYYY-MM-DD',
  })
  partnerSince?: string | null;
}

class UpdateContactDto {
  /** @example Nguyễn Văn A */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  /** @example 0901234567 */
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE_PATTERN, { message: `phone ${PHONE_MESSAGE}` })
  phone?: string | null;
}

/** `PATCH /users/me`. `designerProfile` chỉ cho DESIGNER, `supplierProfile` chỉ cho SUPPLIER. */
export class UpdateMeDto extends UpdateContactDto {
  @IsOptionalNotNull()
  @ValidateNested()
  @Type(() => UpdateMeDesignerProfileDto)
  designerProfile?: UpdateMeDesignerProfileDto;

  @IsOptionalNotNull()
  @ValidateNested()
  @Type(() => UpdateMeSupplierProfileDto)
  supplierProfile?: UpdateMeSupplierProfileDto;
}

/** `PATCH /admin/users/:id`. Không đổi được email, role. */
export class AdminUpdateUserDto extends UpdateContactDto {
  @IsOptionalNotNull()
  @ValidateNested()
  @Type(() => AdminUpdateDesignerProfileDto)
  designerProfile?: AdminUpdateDesignerProfileDto;

  @IsOptionalNotNull()
  @ValidateNested()
  @Type(() => AdminUpdateSupplierProfileDto)
  supplierProfile?: AdminUpdateSupplierProfileDto;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ROLE_CODES)
  role?: RoleCode;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  /** Tìm theo email hoặc họ tên (không phân biệt hoa thường) */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class DesignerAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}
