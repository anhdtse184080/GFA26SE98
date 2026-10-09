import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/decorators.js';
import { CustomerLookupQueryDto } from './dto/customer-lookup.dto.js';
import { CustomerLookupResponseDto } from './dto/user.response.dto.js';
import { UsersService } from './users.service.js';

/** Admin/Staff tìm customer (tự đăng ký, ACTIVE) theo email để mời vào dự án. */
@ApiTags('users')
@Roles('ADMIN', 'STAFF')
@Controller('users/customers')
export class CustomerLookupController {
  constructor(private readonly users: UsersService) {}

  @Get('lookup')
  async lookup(
    @Query() query: CustomerLookupQueryDto,
  ): Promise<CustomerLookupResponseDto> {
    return CustomerLookupResponseDto.from(
      await this.users.findInvitableCustomerByEmail(query.email),
    );
  }
}
