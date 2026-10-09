import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/decorators.js';
import { DesignerAvailabilityDto } from './dto/update-user.dto.js';
import { UserDetailResponseDto } from './dto/user.response.dto.js';
import { UserManagementService } from './user-management.service.js';

@ApiTags('admin-users')
@Roles('ADMIN')
@Controller('admin/designers')
export class AdminDesignersController {
  constructor(private readonly management: UserManagementService) {}

  @Patch(':id/availability')
  async setAvailability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DesignerAvailabilityDto,
  ): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(
      await this.management.setDesignerAvailability(id, dto.isAvailable),
    );
  }
}
