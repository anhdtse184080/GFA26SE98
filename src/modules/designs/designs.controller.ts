import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import {
  requiredFile,
  SingleFileUpload,
  type UploadedFileData,
} from '../../common/upload/single-file-upload.js';
import type { ProductFile } from '../products/products.service.js';
import { DesignCommentsService } from './design-comments.service.js';
import { DesignProductsService } from './design-products.service.js';
import {
  DesignsService,
  invalidDxfFile,
  MAX_DXF_BYTES,
} from './designs.service.js';
import {
  ComparisonQueryDto,
  CreateCommentDto,
  CreateRevisionRequestDto,
  ElementModelQueryDto,
  ListDesignVersionsQueryDto,
  ProductOptionsQueryDto,
  SaveDesignEditDto,
  UpdateCommentStatusDto,
  UploadDesignVersionDto,
} from './dto/designs.dto.js';
import {
  CommentListResponseDto,
  CommentResponseDto,
  DesignVersionDetailResponseDto,
  DesignVersionListResponseDto,
  ProductOptionPageResponseDto,
  RevisionRequestResponseDto,
  VersionComparisonResponseDto,
} from './dto/designs.response.dto.js';

/** Swagger: form upload DXF (file + các field text). */
const UPLOAD_BODY = {
  schema: {
    type: 'object',
    required: ['file', 'title'],
    properties: {
      file: { type: 'string', format: 'binary' },
      title: { type: 'string' },
      description: { type: 'string' },
      revisionType: { type: 'string', enum: ['MINOR', 'MAJOR'] },
      wallHeight: { type: 'number', example: 2.7 },
    },
  },
};

/**
 * Thiết kế Core 3 – mặt bằng 2D: `/projects/:projectId/design-versions`, `/design-versions/:id/...`, `/comments/:id/status`.
 * Xem: Customer / Designer / Staff của dự án và Admin (người ngoài dự án → 404). Không có DELETE (không xóa version, comment).
 */
@ApiTags('designs')
@Controller()
export class DesignsController {
  constructor(
    private readonly designs: DesignsService,
    private readonly designComments: DesignCommentsService,
    private readonly designProducts: DesignProductsService,
  ) {}

  /**
   * Designer của dự án upload DXF mặt bằng (multipart, field `file`, ≤ 20 MB). Bản đầu không gửi `revisionType`;
   * từ bản 2 bắt buộc MINOR | MAJOR; hết lượt Major → 422 REVISION_LIMIT_REACHED. File không phải DXF → 400.
   */
  @Roles('DESIGNER')
  @Post('projects/:projectId/design-versions')
  @UseInterceptors(
    SingleFileUpload('file', MAX_DXF_BYTES, () => invalidDxfFile()),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  async upload(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: UploadDesignVersionDto,
    @UploadedFile(requiredFile()) file: UploadedFileData,
    @CurrentUser() actor: AuthUser,
  ): Promise<DesignVersionDetailResponseDto> {
    return DesignVersionDetailResponseDto.fromDetail(
      await this.designs.uploadLayout(
        projectId,
        actor,
        {
          title: dto.title,
          description: dto.description ?? null,
          revisionType: dto.revisionType ?? null,
          wallHeight: dto.wallHeight,
        },
        file,
      ),
    );
  }

  /** Version của một giai đoạn (`versionType`, mặc định LAYOUT_2D; cũ trước), kèm nhãn và số lượt Major còn lại. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('projects/:projectId/design-versions')
  async list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: ListDesignVersionsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<DesignVersionListResponseDto> {
    return DesignVersionListResponseDto.from(
      await this.designs.listVersions(projectId, actor, query.versionType),
    );
  }

  /** Chi tiết version: scene (tường, cửa, phòng), danh sách món. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-versions/:id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<DesignVersionDetailResponseDto> {
    return DesignVersionDetailResponseDto.fromDetail(
      await this.designs.getVersion(id, actor),
    );
  }

  /** Tải file DXF của version. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-versions/:id/file')
  @ApiProduces('application/dxf')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    const file = await this.designs.downloadFile(id, actor);
    return new StreamableFile(file.data, {
      type: file.contentType,
      length: file.data.length,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  /** Khách yêu cầu sửa bản hiện tại. */
  @Roles('CUSTOMER')
  @Post('design-versions/:id/revision-requests')
  async requestRevision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateRevisionRequestDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<RevisionRequestResponseDto> {
    return RevisionRequestResponseDto.from(
      await this.designs.requestRevision(id, actor, dto.content),
    );
  }

  /**
   * Khách duyệt bản hiện tại hoặc một bản cũ; các bản mới hơn → SUPERSEDED. Mặt bằng: tạo bản RENDER_3D đầu tiên,
   * dự án → PRODUCT_SELECTION. Sản phẩm: mọi món có danh mục phải đã chọn (422 PRODUCTS_NOT_CHOSEN), dự án → QUOTING.
   */
  @Roles('CUSTOMER')
  @Post('design-versions/:id/approval')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<DesignVersionDetailResponseDto> {
    return DesignVersionDetailResponseDto.fromDetail(
      await this.designProducts.approve(id, actor),
    );
  }

  // ---------- Chọn sản phẩm (Core 4), Compare ----------

  /**
   * Designer lưu chỉnh sửa trên bản RENDER_3D hiện tại thành version mới: đổi mẫu cùng danh mục (`selections`),
   * thuộc tính (`overrides`), `chooseAllRemaining`. Sai danh mục → 422 PRODUCT_CATEGORY_MISMATCH.
   */
  @Roles('DESIGNER')
  @Post('design-versions/:id/edits')
  async saveEdit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveDesignEditDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<DesignVersionDetailResponseDto> {
    return DesignVersionDetailResponseDto.fromDetail(
      await this.designProducts.saveEdit(id, actor, {
        title: dto.title,
        description: dto.description ?? null,
        revisionType: dto.revisionType,
        selections: dto.selections ?? [],
        overrides: dto.overrides ?? [],
        chooseAllRemaining: dto.chooseAllRemaining ?? false,
      }),
    );
  }

  /** So 2 version cùng dự án, cùng giai đoạn: món thêm / xóa / dời / đổi mẫu / đổi thuộc tính, chênh lệch tổng tiền. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-versions/:id/comparison')
  async compare(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ComparisonQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<VersionComparisonResponseDto> {
    return VersionComparisonResponseDto.from(
      await this.designProducts.compare(id, query.with, actor),
    );
  }

  /** Sản phẩm đang bán cùng danh mục với món (mọi supplier), rẻ trước, kèm kết quả so kích thước. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-elements/:id/product-options')
  async productOptions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ProductOptionsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductOptionPageResponseDto> {
    return ProductOptionPageResponseDto.from(
      await this.designProducts.productOptions(id, actor, {
        page: query.page,
        limit: query.limit,
      }),
    );
  }

  /** Model 3D (.glb) của sản phẩm đang chọn cho món, hoặc của một lựa chọn (`productId`); quyền theo dự án. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-elements/:id/model-3d')
  @ApiProduces('model/gltf-binary')
  async downloadModel3d(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ElementModelQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    return inlineFile(
      await this.designProducts.downloadProductFile(
        id,
        actor,
        'model-3d',
        query.productId,
      ),
    );
  }

  /** Ảnh sản phẩm đang chọn cho món, hoặc của một lựa chọn (`productId`); quyền theo dự án. */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-elements/:id/thumbnail')
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  async downloadThumbnail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ElementModelQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    return inlineFile(
      await this.designProducts.downloadProductFile(
        id,
        actor,
        'thumbnail',
        query.productId,
      ),
    );
  }

  // ---------- Comment ----------

  /** Comment của version + comment chưa RESOLVED của các bản trước (kèm món ở version này, tìm theo dxfHandle). */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get('design-versions/:id/comments')
  async listComments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<CommentListResponseDto> {
    return CommentListResponseDto.from(
      await this.designComments.listComments(id, actor),
    );
  }

  /** Comment theo món (`designElementId`), chỗ trống (`pinPosition`), chung; hoặc trả lời (`parentCommentId`). */
  @Roles('CUSTOMER', 'DESIGNER', 'STAFF')
  @Post('design-versions/:id/comments')
  async createComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CommentResponseDto> {
    const result = await this.designComments.createComment(id, actor, {
      content: dto.content,
      designElementId: dto.designElementId,
      pinPosition: dto.pinPosition,
      parentCommentId: dto.parentCommentId,
    });
    return CommentResponseDto.fromThread(result.threads[0], result.labels);
  }

  /**
   * Đổi trạng thái comment gốc: `ADDRESS` (Designer, kèm `addressedInVersionId`), `ACCEPT` / `REOPEN` (khách;
   * REOPEN kèm `reply`). Sai chuyển trạng thái → 422 INVALID_COMMENT_STATUS_TRANSITION.
   */
  @Roles('CUSTOMER', 'DESIGNER')
  @Patch('comments/:id/status')
  async changeCommentStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommentStatusDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CommentResponseDto> {
    const result = await this.designComments.changeCommentStatus(id, actor, {
      action: dto.action,
      addressedInVersionId: dto.addressedInVersionId,
      reply: dto.reply,
    });
    return CommentResponseDto.fromThread(result.threads[0], result.labels);
  }
}

function inlineFile(file: ProductFile): StreamableFile {
  return new StreamableFile(file.data, {
    type: file.contentType,
    length: file.data.length,
    disposition: `inline; filename="${file.fileName}"`,
  });
}
