import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpModule } from '../otp/otp.module.js';
import { AccountInvitationService } from './account-invitation.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AdminDesignersController } from './admin-designers.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { CustomerLookupController } from './customer-lookup.controller.js';
import { DesignerProfile } from './entities/designer-profile.entity.js';
import { Role } from './entities/role.entity.js';
import { SupplierProfile } from './entities/supplier-profile.entity.js';
import { User } from './entities/user.entity.js';
import { MeController } from './me.controller.js';
import { TypeOrmUserRepository } from './repositories/typeorm-user.repository.js';
import { USER_REPOSITORY } from './repositories/user.repository.js';
import { UserManagementService } from './user-management.service.js';
import { UserProfileService } from './user-profile.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, DesignerProfile, SupplierProfile]),
    OtpModule,
  ],
  controllers: [
    AdminUsersController,
    AdminDesignersController,
    MeController,
    CustomerLookupController,
  ],
  providers: [
    UsersService,
    AdminAccountsService,
    AccountInvitationService,
    UserProfileService,
    UserManagementService,
    { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
  ],
  exports: [UsersService, AccountInvitationService],
})
export class UsersModule {}
