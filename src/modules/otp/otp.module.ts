import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { OtpVerification } from './entities/otp-verification.entity.js';
import { deriveOtpHashKey } from './otp-code.js';
import { OTP_CONFIG, type OtpConfig } from './otp.config.js';
import { OtpService } from './otp.service.js';
import { OTP_REPOSITORY } from './repositories/otp.repository.js';
import { TypeOrmOtpRepository } from './repositories/typeorm-otp.repository.js';

type Config = ConfigService<EnvironmentVariables, true>;

/** OTP dùng chung cho auth (tự đăng ký, quên mật khẩu) và users (lời mời của Admin). */
@Module({
  imports: [TypeOrmModule.forFeature([OtpVerification])],
  providers: [
    OtpService,
    { provide: OTP_REPOSITORY, useClass: TypeOrmOtpRepository },
    {
      provide: OTP_CONFIG,
      inject: [ConfigService],
      useFactory: (config: Config): OtpConfig => ({
        ttlMinutes: config.get('OTP_TTL_MINUTES', { infer: true }),
        inviteTtlHours: config.get('INVITE_OTP_TTL_HOURS', { infer: true }),
        maxAttempts: config.get('OTP_MAX_ATTEMPTS', { infer: true }),
        resendCooldownSeconds: config.get('OTP_RESEND_COOLDOWN_SECONDS', {
          infer: true,
        }),
        hashKey: deriveOtpHashKey(config.get('JWT_SECRET', { infer: true })),
      }),
    },
  ],
  exports: [OtpService, OTP_CONFIG],
})
export class OtpModule {}
