import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { UserResponseDto } from '../users/dto/users.response.dto.js';
import { AuthService } from './auth.service.js';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';
import {
  ChangePasswordResponseDto,
  LoginResponseDto,
  MessageResponseDto,
  RegisterResponseDto,
  TokenPairResponseDto,
} from './dto/auth.response.dto.js';

/** `/auth/*` (công khai, kiểu RPC – xem ARCHITECTURE §9a) và `PUT /users/me/password`. */
@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Customer tự đăng ký tài khoản (role CUSTOMER, trạng thái INVITED) và nhận OTP kích hoạt qua email. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/register')
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

  /** Customer nhập OTP để xác thực email; tài khoản chuyển sang ACTIVE. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<RegisterResponseDto> {
    const user = await this.auth.verifyEmail(dto.email, dto.otp);
    return {
      message: 'Xác thực email thành công, bạn có thể đăng nhập',
      user: UserResponseDto.from(user),
    };
  }

  /** Staff/Designer/Supplier được Admin mời nhập OTP trong email và tự đặt mật khẩu để kích hoạt tài khoản. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/accept-invite')
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

  /** Gửi lại OTP kích hoạt (hoặc email mời) cho tài khoản còn INVITED. Luôn trả cùng một thông báo để không lộ email có tồn tại hay không. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/resend-otp')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto): Promise<MessageResponseDto> {
    await this.auth.resendActivationOtp(dto.email);
    return {
      message:
        'Nếu email thuộc một tài khoản chưa kích hoạt, mã OTP mới đã được gửi tới email đó',
    };
  }

  /** Đăng nhập bằng email và mật khẩu, trả access token + refresh token. Chỉ tài khoản ACTIVE đăng nhập được; mỗi tài khoản chỉ một phiên (đăng nhập nơi khác thì phiên cũ hết hiệu lực). */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const { accessToken, refreshToken, user } = await this.auth.login(
      dto.email,
      dto.password,
    );
    return { accessToken, refreshToken, user: UserResponseDto.from(user) };
  }

  /** Đổi refresh token lấy cặp token mới (refresh token cũ hết hiệu lực). Dùng lại refresh token cũ → thu hồi cả phiên. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokenPairResponseDto> {
    const { accessToken, refreshToken } = await this.auth.refresh(
      dto.refreshToken,
    );
    return { accessToken, refreshToken };
  }

  /** Đăng xuất: thu hồi phiên của refresh token, mọi access/refresh token của phiên hết hiệu lực ngay. Luôn trả cùng một thông báo. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto): Promise<MessageResponseDto> {
    await this.auth.logout(dto.refreshToken);
    return { message: 'Đăng xuất thành công' };
  }

  /** Gửi OTP đặt lại mật khẩu qua email. Luôn trả cùng một thông báo để không lộ email có tồn tại hay không. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/forgot-password')
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

  /** Đặt lại mật khẩu bằng OTP; mọi phiên đăng nhập cũ hết hiệu lực. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.auth.resetPassword(dto.email, dto.otp, dto.newPassword);
    return { message: 'Đặt lại mật khẩu thành công, vui lòng đăng nhập lại' };
  }

  /** Đổi mật khẩu của chính mình (cần mật khẩu hiện tại); trả cặp token mới, các phiên cũ hết hiệu lực. */
  @ApiTags('users')
  @UseGuards(ThrottlerGuard)
  @Put('users/me/password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() current: AuthUser,
  ): Promise<ChangePasswordResponseDto> {
    const { accessToken, refreshToken, user } = await this.auth.changePassword(
      current.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return {
      message:
        'Đổi mật khẩu thành công, các phiên đăng nhập cũ đã hết hiệu lực',
      accessToken,
      refreshToken,
      user: UserResponseDto.from(user),
    };
  }
}
