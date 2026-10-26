import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ProductsModule } from '../products/products.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { CommentsRepository } from './comments.repository.js';
import { DesignCommentsService } from './design-comments.service.js';
import { DesignProductsService } from './design-products.service.js';
import { DesignVersionsRepository } from './design-versions.repository.js';
import { DesignsController } from './designs.controller.js';
import { DesignsService } from './designs.service.js';
import { Comment } from './entities/comment.entity.js';
import { DesignAsset } from './entities/design-asset.entity.js';
import { DesignElement } from './entities/design-element.entity.js';
import { DesignVersion } from './entities/design-version.entity.js';
import { ProductSelection } from './entities/product-selection.entity.js';
import { RevisionRequest } from './entities/revision-request.entity.js';
import { RevisionRequestsRepository } from './revision-requests.repository.js';

/**
 * `design_versions`, `design_elements`, `design_assets`, `revision_requests`, `comments`.
 * Phụ thuộc `projects` (quyền xem dự án), `catalog` + `products` (gán danh mục cho món theo tên block).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DesignVersion,
      DesignElement,
      DesignAsset,
      RevisionRequest,
      Comment,
      ProductSelection,
    ]),
    ProjectsModule,
    CatalogModule,
    ProductsModule,
  ],
  controllers: [DesignsController],
  providers: [
    DesignsService,
    DesignCommentsService,
    DesignProductsService,
    DesignVersionsRepository,
    CommentsRepository,
    RevisionRequestsRepository,
  ],
  exports: [DesignsService],
})
export class DesignsModule {}
