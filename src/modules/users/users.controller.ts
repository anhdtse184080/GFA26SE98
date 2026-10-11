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
import {
  AdminUpdateUserDto,
  ChangeUserStatusDto,
  CreateAccountDto,
  CustomerLookupQueryDto,
  DesignerAvailabilityDto,
  ListUsersQueryDto,
  UpdateMeDto,
} from './dto/users.dto.js';
import {
  CreateAccountResponseDto,
  CustomerLookupResponseDto,
  InvitationSentResponseDto,
  UserDetailResponseDto,
  UserPageResponseDto,
  UserResponseDto,
} from './dto/users.response.dto.js';
import { UsersService } from './users.service.js';

/**
 * `/users/me` (mọi role đã đăng nhập), `/users/customers` (Admin, Staff), `/admin/users`, `/admin/designers` (Admin).
 * Đổi mật khẩu `PUT /users/me/password` ở `AuthController`.
 */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ---------- User hiện tại ----------

  /** User hiện tại kèm profile designer/supplier. */
  @ApiTags('users')
  @Get('users/me')
  async getMe(
    @CurrentUser() current: AuthUser,
  ): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(
      await this.users.getWithProfiles(current.id),
    );
  }

  /** Tự sửa họ tên, số điện thoại và profile designer/supplier của chính mình. Không đổi được email, role. */
  @ApiTags('users')
  @Patch('users/me')
  async updateMe(
    @Body() dto: UpdateMeDto,
    @CurrentUser() current: AuthUser,
  ): Promise<UserDetailResponseDto> {
    const user = await this.users.updateProfile(current.id, {
      fullName: dto.fullName,
      phone: dto.phone,
      designerProfile: dto.designerProfile,
      supplierProfile: dto.supplierProfile,
    });
    return UserDetailResponseDto.from(user);
  }

  /** Admin/Staff tìm customer theo email để mời vào dự án. Chỉ trả tài khoản customer tự đăng ký và đã ACTIVE. */
  @ApiTags('users')
  @Roles('ADMIN', 'STAFF')
  @Get('users/customers')
  async lookupCustomer(
    @Query() query: CustomerLookupQueryDto,
  ): Promise<CustomerLookupResponseDto> {
    return CustomerLookupResponseDto.from(
      await this.users.findInvitableCustomerByEmail(query.email),
    );
  }

  // ---------- Admin ----------

  /** Danh sách tài khoản, lọc theo role, trạng thái và từ khóa (email hoặc họ tên), có phân trang. */
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Get('admin/users')
  async list(@Query() query: ListUsersQueryDto): Promise<UserPageResponseDto> {
    const page = await this.users.list({
      page: query.page,
      limit: query.limit,
      role: query.role,
      status: query.status,
      keyword: query.q,
    });
    return UserPageResponseDto.from(page);
  }

  /** Chi tiết một tài khoản kèm profile designer/supplier. */
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Get('admin/users/:id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(await this.users.getWithProfiles(id));
  }

  /** Tạo tài khoản Staff/Designer/Supplier (kèm profile tương ứng) và gửi email mời kích hoạt. Không tạo được Customer hay Admin. */
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Post('admin/users')
  async create(
    @Body() dto: CreateAccountDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<CreateAccountResponseDto> {
    const designer = dto.designerProfile;
    const supplier = dto.supplierProfile;
    const user = await this.users.createAccount(
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
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Patch('admin/users/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<UserDetailResponseDto> {
    const user = await this.users.updateProfile(id, {
      fullName: dto.fullName,
      phone: dto.phone,
      designerProfile: dto.designerProfile,
      supplierProfile: dto.supplierProfile,
    });
    return UserDetailResponseDto.from(user);
  }

  /** Gửi lại email mời kích hoạt (OTP mới) cho tài khoản còn INVITED. */
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Post('admin/users/:id/invitations')
  @HttpCode(HttpStatus.OK)
  async resendInvite(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InvitationSentResponseDto> {
    await this.users.resendInvite(id);
    return { message: 'Đã gửi lại email mời kích hoạt' };
  }

  /**
   * Khóa / mở khóa / vô hiệu hóa / kích hoạt lại tài khoản theo `action`:
   * LOCK (ACTIVE | INACTIVE → LOCKED), UNLOCK (LOCKED → ACTIVE),
   * DEACTIVATE (ACTIVE | LOCKED → INACTIVE), REACTIVATE (INACTIVE → ACTIVE).
   * Không tự đổi trạng thái của chính mình, không khóa Admin ACTIVE cuối cùng.
   */
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Patch('admin/users/:id/status')
  async changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeUserStatusDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(
      await this.users.changeStatus(id, dto.action, admin),
    );
  }

  /** Bật/tắt trạng thái sẵn sàng nhận dự án (`isAvailable`) của designer. Staff chỉ giao được designer đang sẵn sàng. */
  @ApiTags('admin-users')
  @Roles('ADMIN')
  @Patch('admin/designers/:id/availability')
  async setDesignerAvailability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DesignerAvailabilityDto,
  ): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(
      await this.users.setDesignerAvailability(id, dto.isAvailable),
    );
  }
}
