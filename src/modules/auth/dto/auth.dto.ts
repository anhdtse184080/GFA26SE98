import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Ít nhất một chữ cái (kể cả có dấu) và một chữ số. */
const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).+$/u;

/**
 * Quy tắc mật khẩu dùng chung cho đăng ký và đặt lại mật khẩu.
 * bcrypt chỉ dùng 72 byte đầu nên giới hạn độ dài.
 */
function IsNewPassword(field: string): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: `${field} phải có ít nhất 8 ký tự` }),
    MaxLength(72),
    Matches(PASSWORD_PATTERN, { message: `${field} phải có cả chữ và số` }),
  );
}

class EmailDto {
  /** @example customer@example.com */
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email: string;
}

export class RegisterDto extends EmailDto {
  /** @example Nguyễn Văn A */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  /** @example 0901234567 */
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?\d{9,15}$/, {
    message: 'phone phải gồm 9–15 chữ số, có thể bắt đầu bằng +',
  })
  phone?: string;

  /**
   * 8–72 ký tự, có cả chữ và số
   * @example Password123
   */
  @IsNewPassword('password')
  password: string;
}

class OtpDto extends EmailDto {
  /**
   * Mã 6 chữ số gửi qua email
   * @example 123456
   */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp phải gồm 6 chữ số' })
  otp: string;
}

export class VerifyEmailDto extends OtpDto {}

export class ResendOtpDto extends EmailDto {}

export class ForgotPasswordDto extends EmailDto {}

export class ResetPasswordDto extends OtpDto {
  /**
   * 8–72 ký tự, có cả chữ và số
   * @example NewPassword123
   */
  @IsNewPassword('newPassword')
  newPassword: string;
}

export class LoginDto extends EmailDto {
  /** @example Password123 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password: string;
}
