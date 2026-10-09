import { Transform, Type } from 'class-transformer';
import {
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
import {
  normalizeEmail,
  PHONE_PATTERN,
  trim,
  trimUpperCase,
} from '../../../common/validation/transforms.js';
import { ROLE_CODES, type RoleCode } from '../role-code.enum.js';

const PHONE_MESSAGE = 'phải gồm 9–15 chữ số, có thể bắt đầu bằng +';

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
