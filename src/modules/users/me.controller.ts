import { Body, Controller, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { UpdateMeDto } from './dto/update-user.dto.js';
import { UserDetailResponseDto } from './dto/user.response.dto.js';
import { UserProfileService } from './user-profile.service.js';

/** Mọi role đã đăng nhập tự sửa thông tin của mình. Đổi mật khẩu ở `AccountController` (module auth). */
@ApiTags('users')
@Controller('users/me')
export class MeController {
  constructor(private readonly profiles: UserProfileService) {}

  @Patch()
  async update(
    @Body() dto: UpdateMeDto,
    @CurrentUser() current: AuthUser,
  ): Promise<UserDetailResponseDto> {
    const user = await this.profiles.update(current.id, {
      fullName: dto.fullName,
      phone: dto.phone,
      designerProfile: dto.designerProfile,
      supplierProfile: dto.supplierProfile,
    });
    return UserDetailResponseDto.from(user);
  }
}
