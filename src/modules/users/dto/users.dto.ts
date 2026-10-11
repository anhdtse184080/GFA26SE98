import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
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
import { ROLE_CODES, type RoleCode } from '../../../common/auth/role-code.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import {
  normalizeEmail,
  PHONE_PATTERN,
  trim,
  trimUpperCase,
} from '../../../common/validation/transforms.js';
import {
  USER_STATUS_ACTIONS,
  USER_STATUSES,
  type UserStatus,
  type UserStatusAction,
} from '../entities/user.entity.js';

const PHONE_MESSAGE = 'phải gồm 9–15 chữ số, có thể bắt đầu bằng +';

// ---------- Tạo tài khoản (Admin) ----------

export class CreateDesignerProfileDto {
  /**
   * Mã nhân viên, duy nhất (tự viết hoa)
   * @example NV001
   */
  @Transform(trimUpperCase)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  employeeCode: string;

  /** @example Kiến trúc sư */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  title?: string;

  /** @example Căn hộ phong cách Japandi, Scandinavian */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  specialization?: string;

  /** @example 5 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsOfExperience?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  bio?: string;
}

export class CreateSupplierProfileDto {
  /** @example Công ty TNHH Nội thất ABC */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  companyName: string;

  /**
   * Mã số thuế (10 số, chi nhánh thêm `-xxx`), duy nhất
   * @example 0312345678
   */
  @Transform(trim)
  @IsString()
  @Matches(/^\d{10}(-\d{3})?$/, {
    message: 'taxCode phải gồm 10 chữ số, có thể thêm -xxx (chi nhánh)',
  })
  taxCode: string;

  /** @example 123 Nguyễn Văn Linh, Quận 7, TP.HCM */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  businessAddress: string;

  /** @example Trần Thị B */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  contactName?: string;

  /** @example 0281234567 */
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE_PATTERN, { message: `contactPhone ${PHONE_MESSAGE}` })
  contactPhone?: string;

  /** @example https://abc-noithat.vn */
  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true }, { message: 'website không hợp lệ' })
  @MaxLength(255)
  website?: string;

  /**
   * Ngày bắt đầu hợp tác (YYYY-MM-DD)
   * @example 2026-01-15
   */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'partnerSince phải có dạng YYYY-MM-DD',
  })
  partnerSince?: string;
}

/** Admin tạo tài khoản Staff/Designer/Supplier. */
export class CreateAccountDto {
  /** @example designer01@fa26se095.local */
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email: string;

  /** @example Lê Văn C */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  /** @example 0901234567 */
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE_PATTERN, { message: `phone ${PHONE_MESSAGE}` })
  phone?: string;

  /**
   * Chỉ STAFF | DESIGNER | SUPPLIER (role khác → 422 ROLE_NOT_ALLOWED)
   * @example DESIGNER
   */
  @IsIn(ROLE_CODES)
  role: RoleCode;

  /** Bắt buộc khi role = DESIGNER */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateDesignerProfileDto)
  designerProfile?: CreateDesignerProfileDto;

  /** Bắt buộc khi role = SUPPLIER */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSupplierProfileDto)
  supplierProfile?: CreateSupplierProfileDto;
}

// ---------- Sửa thông tin, danh sách, trạng thái ----------

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

/**
 * LOCK: ACTIVE | INACTIVE → LOCKED · UNLOCK: LOCKED → ACTIVE ·
 * DEACTIVATE: ACTIVE | LOCKED → INACTIVE · REACTIVATE: INACTIVE → ACTIVE
 */
export class ChangeUserStatusDto {
  /** @example LOCK */
  @IsIn(USER_STATUS_ACTIONS)
  action: UserStatusAction;
}

export class DesignerAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

// ---------- Tra cứu customer ----------

export class CustomerLookupQueryDto {
  /** @example customer@example.com */
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email: string;
}
