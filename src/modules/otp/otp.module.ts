import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpVerification } from './entities/otp-verification.entity.js';
import { OtpRepository } from './otp.repository.js';
import { OtpService } from './otp.service.js';

/** OTP dùng chung cho auth (tự đăng ký, quên mật khẩu) và users (lời mời của Admin). */
@Module({
  imports: [TypeOrmModule.forFeature([OtpVerification])],
  providers: [OtpService, OtpRepository],
  exports: [OtpService],
})
export class OtpModule {}
