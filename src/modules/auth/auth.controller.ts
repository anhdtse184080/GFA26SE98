import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { AuthService } from './auth.service.js';
import {
  UserDetailResponseDto,
  UserResponseDto,
} from '../users/dto/user.response.dto.js';
import {
  AcceptInviteDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';
import {
  LoginResponseDto,
  MessageResponseDto,
  RegisterResponseDto,
} from './dto/auth.response.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const user = await this.auth.register({
      email: dto.email,
      fullName: dto.fullName,
      phone: dto.phone ?? null,
      password: dto.password,
    });
    return {
      message:
        'Đăng ký thành công, vui lòng kiểm tra email để lấy mã OTP kích hoạt tài khoản',
      user: UserResponseDto.from(user),
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<RegisterResponseDto> {
    const user = await this.auth.verifyEmail(dto.email, dto.otp);
    return {
      message: 'Xác thực email thành công, bạn có thể đăng nhập',
      user: UserResponseDto.from(user),
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
  ): Promise<RegisterResponseDto> {
    const user = await this.auth.acceptInvite(dto.email, dto.otp, dto.password);
    return {
      message: 'Kích hoạt tài khoản thành công, bạn có thể đăng nhập',
      user: UserResponseDto.from(user),
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto): Promise<MessageResponseDto> {
    await this.auth.resendActivationOtp(dto.email);
    return {
      message:
        'Nếu email thuộc một tài khoản chưa kích hoạt, mã OTP mới đã được gửi tới email đó',
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const { accessToken, user } = await this.auth.login(
      dto.email,
      dto.password,
    );
    return { accessToken, user: UserResponseDto.from(user) };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.auth.requestPasswordReset(dto.email);
    return {
      message:
        'Nếu email thuộc một tài khoản đang hoạt động, mã OTP đặt lại mật khẩu đã được gửi tới email đó',
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.auth.resetPassword(dto.email, dto.otp, dto.newPassword);
    return { message: 'Đặt lại mật khẩu thành công, vui lòng đăng nhập lại' };
  }

  @Get('me')
  async me(@CurrentUser() current: AuthUser): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(await this.auth.me(current.id));
  }
}
