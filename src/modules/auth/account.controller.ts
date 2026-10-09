import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { UserResponseDto } from '../users/dto/user.response.dto.js';
import { ChangePasswordDto } from './dto/auth.dto.js';
import { ChangePasswordResponseDto } from './dto/auth.response.dto.js';
import { PasswordChangeService } from './password-change.service.js';

/** Thao tác tài khoản cần JWT của user hiện tại. Sửa thông tin cá nhân ở `MeController` (module users). */
@ApiTags('users')
@Controller('users/me')
export class AccountController {
  constructor(private readonly passwords: PasswordChangeService) {}

  @UseGuards(ThrottlerGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() current: AuthUser,
  ): Promise<ChangePasswordResponseDto> {
    const { accessToken, user } = await this.passwords.change(
      current.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return {
      message:
        'Đổi mật khẩu thành công, các phiên đăng nhập cũ đã hết hiệu lực',
      accessToken,
      user: UserResponseDto.from(user),
    };
  }
}
