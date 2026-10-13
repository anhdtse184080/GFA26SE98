import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DesignStylesController } from './design-styles.controller.js';
import { DesignStylesRepository } from './design-styles.repository.js';
import { DesignStylesService } from './design-styles.service.js';
import { DesignStyle } from './entities/design-style.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([DesignStyle])],
  controllers: [DesignStylesController],
  providers: [DesignStylesService, DesignStylesRepository],
  exports: [DesignStylesService],
})
export class DesignStylesModule {}
