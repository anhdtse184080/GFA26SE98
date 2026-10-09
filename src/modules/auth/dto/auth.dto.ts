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

class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email: string;
}

export class RegisterDto extends EmailDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?\d{9,15}$/, {
    message: 'phone phải gồm 9–15 chữ số, có thể bắt đầu bằng +',
  })
  phone?: string;

  /** bcrypt chỉ dùng 72 byte đầu nên giới hạn độ dài. */
  @IsString()
  @MinLength(8, { message: 'password phải có ít nhất 8 ký tự' })
  @MaxLength(72)
  @Matches(PASSWORD_PATTERN, { message: 'password phải có cả chữ và số' })
  password: string;
}

export class VerifyEmailDto extends EmailDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp phải gồm 6 chữ số' })
  otp: string;
}

export class ResendOtpDto extends EmailDto {}

export class LoginDto extends EmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password: string;
}
