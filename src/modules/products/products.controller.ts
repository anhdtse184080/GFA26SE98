import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/products.dto.js';
import {
  ProductPageResponseDto,
  ProductResponseDto,
} from './dto/products.response.dto.js';
import {
  invalidImageFile,
  invalidModelFile,
  MAX_MODEL_3D_BYTES,
  MAX_THUMBNAIL_BYTES,
  type ProductFile,
  ProductsService,
} from './products.service.js';

/** Swagger: body multipart một field `file`. */
const FILE_BODY: Parameters<typeof ApiBody>[0] = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

/**
 * `/products`: Supplier quản lý sản phẩm của mình (kể cả ảnh, model 3D); Designer/Staff/Admin xem.
 * Không có DELETE: sản phẩm ngừng bán bằng `status: INACTIVE`.
 */
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * Supplier: sản phẩm của mình (mọi status). Designer/Staff: chỉ ACTIVE của supplier đang hợp tác.
   * Admin: tất cả, lọc được theo `supplierId`. `minPrice > maxPrice` → 422 INVALID_PRICE_RANGE.
   */
  @Roles('SUPPLIER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get()
  async listProducts(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductPageResponseDto> {
    const page = await this.products.search(actor, {
      keyword: query.q,
      categoryId: query.categoryId,
      styleId: query.styleId,
      supplierId: query.supplierId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      stockStatus: query.stockStatus,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return ProductPageResponseDto.from(page, actor);
  }

  /** Sản phẩm không được xem (của supplier khác, INACTIVE với Designer/Staff…) → 404. */
  @Roles('SUPPLIER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get(':id')
  async productDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(
      await this.products.getProduct(id, actor),
      actor,
    );
  }

  /** Tạo sản phẩm trong catalog của mình. Trùng `sku` → 409 PRODUCT_SKU_EXISTS. */
  @Roles('SUPPLIER')
  @Post()
  async createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    const product = await this.products.create(actor, {
      categoryId: dto.categoryId,
      sku: dto.sku,
      name: dto.name,
      description: dto.description ?? null,
      brand: dto.brand ?? null,
      material: dto.material ?? null,
      colorName: dto.colorName ?? null,
      colorCode: dto.colorCode ?? null,
      widthMm: dto.widthMm ?? null,
      depthMm: dto.depthMm ?? null,
      heightMm: dto.heightMm ?? null,
      unit: dto.unit,
      price: dto.price,
      stockStatus: dto.stockStatus,
      specifications: dto.specifications ?? null,
      styleIds: dto.styleIds ?? [],
      status: dto.status ?? 'ACTIVE',
    });
    return ProductResponseDto.from(product, actor);
  }

  /** Sửa sản phẩm của mình (của supplier khác → 404); `styleIds` thay toàn bộ; `status: INACTIVE` = ngừng bán. */
  @Roles('SUPPLIER')
  @Patch(':id')
  async updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(
      await this.products.update(id, actor, dto),
      actor,
    );
  }

  // ---------- File sản phẩm ----------

  /**
   * Thay ảnh đại diện sản phẩm của mình (multipart field `file`): PNG/JPEG/WebP ≤ 5 MB.
   * Sai định dạng / quá lớn → 422 INVALID_IMAGE_FILE.
   */
  @Roles('SUPPLIER')
  @Put(':id/thumbnail')
  @UseInterceptors(
    SingleFileUpload('file', MAX_THUMBNAIL_BYTES, () => invalidImageFile()),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  async uploadThumbnail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile(requiredFile()) file: UploadedFileData,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(
      await this.products.uploadThumbnail(id, actor, file),
      actor,
    );
  }

  /** Ảnh sản phẩm (ai xem được sản phẩm). Chưa có ảnh → 404 PRODUCT_FILE_NOT_FOUND. */
  @Roles('SUPPLIER', 'DESIGNER', 'STAFF', 'ADMIN')
  @Get(':id/thumbnail')
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  async downloadThumbnail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    return toStreamable(
      await this.products.downloadFile(id, 'thumbnail', actor),
    );
  }

  /**
   * Thay model 3D sản phẩm của mình (multipart field `file`): glTF binary `.glb` ≤ 25 MB.
   * Sai định dạng / quá lớn → 422 INVALID_MODEL_FILE.
   */
  @Roles('SUPPLIER')
  @Put(':id/model-3d')
  @UseInterceptors(
    SingleFileUpload('file', MAX_MODEL_3D_BYTES, () => invalidModelFile()),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  async uploadModel3d(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile(requiredFile()) file: UploadedFileData,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(
      await this.products.uploadModel3d(id, actor, file),
      actor,
    );
  }

  /** Model 3D `.glb`: chỉ Supplier chủ sản phẩm và Designer. Chưa có file → 404 PRODUCT_FILE_NOT_FOUND. */
  @Roles('SUPPLIER', 'DESIGNER')
  @Get(':id/model-3d')
  @ApiProduces('model/gltf-binary')
  async downloadModel3d(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    return toStreamable(
      await this.products.downloadFile(id, 'model-3d', actor),
    );
  }
}

function toStreamable(file: ProductFile): StreamableFile {
  return new StreamableFile(file.data, {
    type: file.contentType,
    length: file.data.length,
    disposition: `inline; filename="${file.fileName}"`,
  });
}
