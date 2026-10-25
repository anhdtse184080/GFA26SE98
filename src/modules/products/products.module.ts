import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module.js';
import { DesignStylesModule } from '../design-styles/design-styles.module.js';
import { ProductStyle } from './entities/product-style.entity.js';
import { Product } from './entities/product.entity.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

/** `products` + `product_styles`. Phụ thuộc `catalog` (danh mục, supplier đang hợp tác) và `design-styles`. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductStyle]),
    CatalogModule,
    DesignStylesModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
