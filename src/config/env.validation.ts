import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;

export const MAIL_DRIVERS = ['smtp', 'log'] as const;

export type MailDriver = (typeof MAIL_DRIVERS)[number];

export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: (typeof NODE_ENVS)[number];

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  POSTGRES_PORT: number;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB: string;

  @IsString()
  @IsNotEmpty()
  MONGO_URI: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRES_IN: string;

  /** Tài khoản Admin đầu tiên do `npm run seed` tạo. */
  @IsEmail()
  SEED_ADMIN_EMAIL: string;

  @IsString()
  @MinLength(8)
  SEED_ADMIN_PASSWORD: string;

  /** Gốc URL của frontend, dùng tạo link trong email mời kích hoạt. */
  @IsUrl({ require_tld: false, require_protocol: true })
  FRONTEND_URL: string;

  /** `log` (mặc định): chỉ in email ra log. `smtp`: gửi thật, bắt buộc đủ biến MAIL_*. */
  @IsIn(MAIL_DRIVERS)
  MAIL_DRIVER: MailDriver = 'log';

  @ValidateIf(isSmtp)
  @IsString()
  @IsNotEmpty()
  MAIL_HOST?: string;

  @ValidateIf(isSmtp)
  @IsInt()
  @Min(1)
  @Max(65535)
  MAIL_PORT?: number;

  /** Chuyển tay vì implicit conversion biến chuỗi `'false'` thành `true`. */
  @ValidateIf(isSmtp)
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parseBoolean(obj.MAIL_SECURE),
  )
  @IsBoolean()
  MAIL_SECURE?: boolean;

  @ValidateIf(isSmtp)
  @IsString()
  @IsNotEmpty()
  MAIL_USER?: string;

  @ValidateIf(isSmtp)
  @IsString()
  @IsNotEmpty()
  MAIL_PASSWORD?: string;

  @ValidateIf(isSmtp)
  @IsString()
  @IsNotEmpty()
  MAIL_FROM?: string;

  /** Thời gian sống của OTP (phút). */
  @IsInt()
  @Min(1)
  OTP_TTL_MINUTES: number = 15;

  /** Số lần nhập sai tối đa cho một OTP. */
  @IsInt()
  @Min(1)
  OTP_MAX_ATTEMPTS: number = 5;

  /** Khoảng chờ tối thiểu giữa hai lần gửi OTP (giây). */
  @IsInt()
  @Min(1)
  OTP_RESEND_COOLDOWN_SECONDS: number = 60;

  /** Rate limit cho login/register/resend-otp/verify-email: tối đa `LIMIT` request mỗi `TTL` giây, theo IP + route. */
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_LIMIT: number = 10;

  @IsInt()
  @Min(1)
  AUTH_THROTTLE_TTL_SECONDS: number = 60;
}

function isSmtp(env: EnvironmentVariables): boolean {
  return env.MAIL_DRIVER === 'smtp';
}

function parseBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** Validate biến môi trường khi khởi động; thiếu hoặc sai thì ném lỗi để app dừng. */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const lines = errors.map(
      (e) =>
        ` - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    );
    throw new Error(
      `Invalid environment variables (kiểm tra file .env, xem .env.example):\n${lines.join('\n')}`,
    );
  }
  return env;
}
