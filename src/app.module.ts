import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ApartmentsModule } from './modules/apartments/apartments.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { DesignStylesModule } from './modules/design-styles/design-styles.module.js';
import { DesignsModule } from './modules/designs/designs.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    DesignStylesModule,
    CatalogModule,
    ProductsModule,
    ApartmentsModule,
    ProjectsModule,
    DesignsModule,
  ],
})
export class AppModule {}
