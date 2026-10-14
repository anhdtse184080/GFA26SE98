import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DesignStylesModule } from '../design-styles/design-styles.module.js';
import { UsersModule } from '../users/users.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { ProductCategory } from './entities/product-category.entity.js';
import { ProductStyle } from './entities/product-style.entity.js';
import { Product } from './entities/product.entity.js';
import { ProductCategoriesRepository } from './product-categories.repository.js';
import { ProductsRepository } from './products.repository.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductCategory, Product, ProductStyle]),
    UsersModule,
    DesignStylesModule,
  ],
  controllers: [CatalogController],
  providers: [CatalogService, ProductCategoriesRepository, ProductsRepository],
  exports: [CatalogService],
})
export class CatalogModule {}
