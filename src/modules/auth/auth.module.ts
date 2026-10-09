import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpVerification } from './entities/otp-verification.entity.js';
import { JWT_SECRET, JwtStrategy } from './jwt.strategy.js';
import { deriveOtpHashKey } from './otp-code.js';
import { OTP_CONFIG, type OtpConfig } from './otp.config.js';
import { OtpService } from './otp.service.js';
import {
  derivePasswordFingerprintKey,
  PASSWORD_FINGERPRINT_KEY,
} from './password-fingerprint.js';
import { OTP_REPOSITORY } from './repositories/otp.repository.js';
import { TypeOrmOtpRepository } from './repositories/typeorm-otp.repository.js';

type Config = ConfigService<EnvironmentVariables, true>;

const MS_PER_SECOND = 1_000;

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpVerification]),
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: Config) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          // Chuỗi dạng `1d`, `15m` (thư viện `ms`) hoặc số giây; validateEnv đã kiểm tra không rỗng.
          expiresIn: config.get('JWT_EXPIRES_IN', {
            infer: true,
          }) as `${number}d`,
        },
      }),
    }),
    // Chỉ áp dụng cho route gắn @UseGuards(ThrottlerGuard) (không đăng ký guard toàn cục).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: Config) => [
        {
          ttl:
            config.get('AUTH_THROTTLE_TTL_SECONDS', { infer: true }) *
            MS_PER_SECOND,
          limit: config.get('AUTH_THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    JwtStrategy,
    { provide: OTP_REPOSITORY, useClass: TypeOrmOtpRepository },
    {
      provide: OTP_CONFIG,
      inject: [ConfigService],
      useFactory: (config: Config): OtpConfig => ({
        ttlMinutes: config.get('OTP_TTL_MINUTES', { infer: true }),
        maxAttempts: config.get('OTP_MAX_ATTEMPTS', { infer: true }),
        resendCooldownSeconds: config.get('OTP_RESEND_COOLDOWN_SECONDS', {
          infer: true,
        }),
        hashKey: deriveOtpHashKey(config.get('JWT_SECRET', { infer: true })),
      }),
    },
    {
      provide: PASSWORD_FINGERPRINT_KEY,
      inject: [ConfigService],
      useFactory: (config: Config) =>
        derivePasswordFingerprintKey(config.get('JWT_SECRET', { infer: true })),
    },
    {
      provide: JWT_SECRET,
      inject: [ConfigService],
      useFactory: (config: Config) => config.get('JWT_SECRET', { infer: true }),
    },
    // Thứ tự đăng ký = thứ tự chạy: xác thực token trước, kiểm tra role sau.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [OtpService],
})
export class AuthModule {}
