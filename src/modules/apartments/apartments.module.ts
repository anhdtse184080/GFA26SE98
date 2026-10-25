import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { ApartmentsController } from './apartments.controller.js';
import { ApartmentsRepository } from './apartments.repository.js';
import { ApartmentsService } from './apartments.service.js';
import { Apartment } from './entities/apartment.entity.js';
import { Room } from './entities/room.entity.js';

/** `apartments` + `rooms`. Phụ thuộc `users` (tìm customer theo email). */
@Module({
  imports: [TypeOrmModule.forFeature([Apartment, Room]), UsersModule],
  controllers: [ApartmentsController],
  providers: [ApartmentsService, ApartmentsRepository],
  exports: [ApartmentsService],
})
export class ApartmentsModule {}
