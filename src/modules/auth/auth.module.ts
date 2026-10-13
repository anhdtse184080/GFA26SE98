import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { OtpModule } from '../otp/otp.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { LocalStrategy } from './local.strategy.js';

type Config = ConfigService<EnvironmentVariables, true>;

const MS_PER_SECOND = 1_000;

@Module({
  imports: [
    UsersModule,
    OtpModule,
    PassportModule,
    // Cấu hình mặc định cho access token; refresh token ký bằng khóa riêng trong AuthService.
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
    JwtStrategy,
    LocalStrategy,
    // Thứ tự đăng ký = thứ tự chạy: xác thực token trước, kiểm tra role sau.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
