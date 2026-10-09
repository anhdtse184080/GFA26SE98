import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
