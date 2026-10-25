import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { ProductCategory } from './entities/product-category.entity.js';
import { ProductCategoriesRepository } from './product-categories.repository.js';

@Module({
  imports: [TypeOrmModule.forFeature([ProductCategory]), UsersModule],
  controllers: [CatalogController],
  providers: [CatalogService, ProductCategoriesRepository],
  exports: [CatalogService],
})
export class CatalogModule {}
