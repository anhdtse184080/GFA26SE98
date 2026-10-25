import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApartmentsModule } from '../apartments/apartments.module.js';
import { DesignStylesModule } from '../design-styles/design-styles.module.js';
import { UsersModule } from '../users/users.module.js';
import { Project } from './entities/project.entity.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsRepository } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

/** `projects`. Phụ thuộc `apartments`, `users` (chủ căn), `design-styles`. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Project]),
    ApartmentsModule,
    UsersModule,
    DesignStylesModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
