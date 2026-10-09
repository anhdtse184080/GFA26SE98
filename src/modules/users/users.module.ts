import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DesignerProfile } from './entities/designer-profile.entity.js';
import { Role } from './entities/role.entity.js';
import { SupplierProfile } from './entities/supplier-profile.entity.js';
import { User } from './entities/user.entity.js';
import { TypeOrmUserRepository } from './repositories/typeorm-user.repository.js';
import { USER_REPOSITORY } from './repositories/user.repository.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, DesignerProfile, SupplierProfile]),
  ],
  providers: [
    UsersService,
    { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
