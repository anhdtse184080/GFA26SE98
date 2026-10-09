import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import {
  AdminUpdateUserDto,
  ListUsersQueryDto,
} from './dto/update-user.dto.js';
import {
  CreateAccountResponseDto,
  InvitationSentResponseDto,
  UserDetailResponseDto,
  UserPageResponseDto,
  UserResponseDto,
} from './dto/user.response.dto.js';
import { UserManagementService } from './user-management.service.js';
import { UserProfileService } from './user-profile.service.js';
import type { UserStatusAction } from './user-status.js';

@ApiTags('admin-users')
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly management: UserManagementService,
    private readonly profiles: UserProfileService,
  ) {}

  @Get()
  async list(@Query() query: ListUsersQueryDto): Promise<UserPageResponseDto> {
    const page = await this.management.list({
      page: query.page,
      limit: query.limit,
      role: query.role,
      status: query.status,
      keyword: query.q,
    });
    return UserPageResponseDto.from(page);
  }

  @Get(':id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(await this.management.getDetail(id));
  }

  @Post()
  async create(
    @Body() dto: CreateAccountDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<CreateAccountResponseDto> {
    const designer = dto.designerProfile;
    const supplier = dto.supplierProfile;
    const user = await this.accounts.create(
      {
        email: dto.email,
        fullName: dto.fullName,
        phone: dto.phone ?? null,
        role: dto.role,
        designerProfile: designer
          ? {
              employeeCode: designer.employeeCode,
              title: designer.title ?? null,
              specialization: designer.specialization ?? null,
              yearsOfExperience: designer.yearsOfExperience ?? null,
              bio: designer.bio ?? null,
            }
          : null,
        supplierProfile: supplier
          ? {
              companyName: supplier.companyName,
              taxCode: supplier.taxCode,
              businessAddress: supplier.businessAddress,
              contactName: supplier.contactName ?? null,
              contactPhone: supplier.contactPhone ?? null,
              website: supplier.website ?? null,
              partnerSince: supplier.partnerSince ?? null,
            }
          : null,
      },
      admin,
    );
    return {
      message: 'Đã tạo tài khoản và gửi email mời kích hoạt',
      user: UserDetailResponseDto.from(user),
    };
  }

  /** Sửa họ tên, số điện thoại, profile designer/supplier. Không đổi email, role. */
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<UserDetailResponseDto> {
    const user = await this.profiles.update(id, {
      fullName: dto.fullName,
      phone: dto.phone,
      designerProfile: dto.designerProfile,
      supplierProfile: dto.supplierProfile,
    });
    return UserDetailResponseDto.from(user);
  }

  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.OK)
  async resendInvite(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InvitationSentResponseDto> {
    await this.accounts.resendInvite(id);
    return { message: 'Đã gửi lại email mời kích hoạt' };
  }

  /** ACTIVE | INACTIVE → LOCKED */
  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  lock(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<UserResponseDto> {
    return this.changeStatus(id, 'LOCK', admin);
  }

  /** LOCKED → ACTIVE */
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<UserResponseDto> {
    return this.changeStatus(id, 'UNLOCK', admin);
  }

  /** ACTIVE | LOCKED → INACTIVE */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<UserResponseDto> {
    return this.changeStatus(id, 'DEACTIVATE', admin);
  }

  /** INACTIVE → ACTIVE */
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<UserResponseDto> {
    return this.changeStatus(id, 'REACTIVATE', admin);
  }

  private async changeStatus(
    id: string,
    action: UserStatusAction,
    admin: AuthUser,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(
      await this.management.changeStatus(id, action, admin),
    );
  }
}
