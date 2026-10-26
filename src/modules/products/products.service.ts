import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../../common/ports/file-storage.js';
import type { UploadedFileData } from '../../common/upload/single-file-upload.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { DesignStylesService } from '../design-styles/design-styles.service.js';
import {
  Product,
  type ProductPatch,
  type ProductStatus,
  type StockStatus,
} from './entities/product.entity.js';
import { ProductsRepository } from './products.repository.js';

export interface SearchProductsInput extends PageRequest {
  keyword?: string;
  categoryId?: string;
  styleId?: string;
  /** Chỉ có tác dụng với Admin/Designer/Staff; Supplier luôn bị giới hạn về sản phẩm của mình. */
  supplierId?: string;
  minPrice?: string;
  maxPrice?: string;
  stockStatus?: StockStatus;
  status?: ProductStatus;
}

/** Field nullable đã được controller chuẩn hóa `undefined` → `null`. `price` là chuỗi thập phân > 0. */
export type CreateProductInput = Required<ProductPatch> & {
  categoryId: string;
  price: string;
  styleIds: string[];
};

/** `undefined` = giữ nguyên. `styleIds` có mặt thì thay toàn bộ phong cách. */
export type UpdateProductInput = ProductPatch & {
  categoryId?: string;
  price?: string;
  styleIds?: string[];
};

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const MAX_MODEL_3D_BYTES = 25 * 1024 * 1024;

export type ProductFileKind = 'thumbnail' | 'model-3d';

/** File tải về: nội dung + metadata để controller dựng response. */
export interface ProductFile {
  data: Buffer;
  contentType: string;
  fileName: string;
}

/** Đuôi file (lấy từ khóa) → Content-Type. Định dạng do magic bytes quyết định, không tin `mimetype` client gửi. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
/** Header glTF binary: magic `glTF`, version (uint32 LE) = 2, length (uint32 LE) = kích thước file. */
const GLB_MAGIC = Buffer.from('glTF', 'ascii');
const GLB_HEADER_BYTES = 12;
const GLB_VERSION = 2;

/** Dùng cả ở interceptor upload (multer chặn file vượt giới hạn). */
export function invalidImageFile(
  message = 'Ảnh phải là PNG, JPEG hoặc WebP, tối đa 5 MB',
): BusinessRuleError {
  return new BusinessRuleError('INVALID_IMAGE_FILE', message, {
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: MAX_THUMBNAIL_BYTES,
  });
}

export function invalidModelFile(
  message = 'Model 3D phải là file glTF binary (.glb), tối đa 25 MB',
): BusinessRuleError {
  return new BusinessRuleError('INVALID_MODEL_FILE', message, {
    allowedTypes: ['model/gltf-binary'],
    maxBytes: MAX_MODEL_3D_BYTES,
  });
}

/**
 * Sản phẩm của supplier đối tác (`products`, `product_styles`):
 * - Supplier tạo/sửa/xem của mình (mọi status); Designer/Staff chỉ xem sản phẩm ACTIVE của supplier
 *   đang hợp tác (chọn đồ ở Core Flow 4); Admin xem tất cả. Không xóa: ngừng bán bằng `status = INACTIVE`.
 * - Danh mục (dùng chung, Admin tạo) và điều kiện supplier đang hợp tác kiểm tra qua `CatalogService`.
 * - `block_code` hệ thống tự sinh lúc tạo (`<code danh mục>-<4 chữ số>`), không nhận từ request, không sửa được.
 * - File sản phẩm (ảnh, model 3D .glb): DB chỉ lưu khóa trên FileStorage; tải qua API có kiểm tra quyền.
 */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly products: ProductsRepository,
    private readonly catalog: CatalogService,
    private readonly styles: DesignStylesService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /**
   * Supplier: chỉ sản phẩm của mình (mọi status). Designer/Staff: chỉ ACTIVE của supplier đang hợp tác.
   * Admin: tất cả.
   * @throws BusinessRuleError `INVALID_PRICE_RANGE`
   */
  search(
    actor: AuthUser,
    input: SearchProductsInput,
  ): Promise<Paginated<Product>> {
    const { page, limit, ...filter } = input;
    if (
      filter.minPrice !== undefined &&
      filter.maxPrice !== undefined &&
      new Decimal(filter.minPrice).greaterThan(filter.maxPrice)
    ) {
      throw new BusinessRuleError(
        'INVALID_PRICE_RANGE',
        'minPrice không được lớn hơn maxPrice',
        { minPrice: filter.minPrice, maxPrice: filter.maxPrice },
      );
    }
    return this.products.search(
      {
        ...filter,
        keyword: filter.keyword || undefined,
        supplierId: actor.role === 'SUPPLIER' ? actor.id : filter.supplierId,
        visibleToBuyers: actor.role === 'DESIGNER' || actor.role === 'STAFF',
      },
      { page, limit },
    );
  }

  /** @throws NotFoundError `PRODUCT_NOT_FOUND` (cả khi actor không được xem sản phẩm này) */
  async getProduct(id: string, actor: AuthUser): Promise<Product> {
    const product = await this.getProductOrThrow(id);
    if (!this.canViewProduct(product, actor)) throw this.productNotFound(id);
    return product;
  }

  /**
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `CATEGORY_INACTIVE` | `DESIGN_STYLE_INACTIVE`
   * @throws NotFoundError `CATEGORY_NOT_FOUND` | `DESIGN_STYLE_NOT_FOUND`
   * @throws ConflictError `PRODUCT_SKU_EXISTS`
   */
  async create(actor: AuthUser, input: CreateProductInput): Promise<Product> {
    const id = await this.uow.run(async () => {
      const supplierId = await this.catalog.getActiveSupplierId(actor);
      const { categoryId, price, styleIds, ...fields } = input;
      // Khóa dòng danh mục đến hết transaction → hai lượt tạo cùng danh mục không lấy trùng số block_code.
      const category =
        await this.catalog.getUsableCategoryForUpdate(categoryId);
      await this.assertActiveStyles(styleIds);
      const product = Object.assign(new Product(), fields, {
        supplierId,
        categoryId,
      });
      const lastSeq = await this.products.findLastBlockCodeSeq(category.code);
      product.assignBlockCode(category.code, lastSeq + 1);
      product.changePrice(new Decimal(price), this.clock.now());
      const saved = await this.products.saveIfSkuAvailable(product, styleIds);
      if (!saved) throw this.skuTaken(fields.sku);
      return saved.id;
    });
    return this.getProductOrThrow(id);
  }

  /**
   * Chỉ sửa sản phẩm của mình (của supplier khác → 404). Đổi giá → cập nhật `price_updated_at`.
   * Chỉ khi có `styleIds` mới thay toàn bộ `product_styles`.
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `CATEGORY_INACTIVE` | `DESIGN_STYLE_INACTIVE`
   * @throws NotFoundError `PRODUCT_NOT_FOUND` | `CATEGORY_NOT_FOUND` | `DESIGN_STYLE_NOT_FOUND`
   * @throws ConflictError `PRODUCT_SKU_EXISTS`
   */
  async update(
    id: string,
    actor: AuthUser,
    input: UpdateProductInput,
  ): Promise<Product> {
    await this.uow.run(async () => {
      const supplierId = await this.catalog.getActiveSupplierId(actor);
      const product = await this.getProductOrThrow(id);
      if (product.supplierId !== supplierId) throw this.productNotFound(id);

      const { categoryId, price, styleIds, ...patch } = input;
      if (categoryId !== undefined && categoryId !== product.categoryId) {
        await this.catalog.getUsableCategoryForUpdate(categoryId);
        product.moveToCategory(categoryId);
      }
      if (styleIds !== undefined) await this.assertActiveStyles(styleIds);
      if (price !== undefined) {
        product.changePrice(new Decimal(price), this.clock.now());
      }
      product.update(patch);
      // styleIds không gửi → undefined → repository không đụng tới product_styles
      const saved = await this.products.saveIfSkuAvailable(product, styleIds);
      if (!saved) throw this.skuTaken(patch.sku);
    });
    return this.getProductOrThrow(id);
  }

  /**
   * `block_code` → `category_id` của sản phẩm (module designs: block DXF trùng mẫu thật thì món thuộc danh mục của mẫu đó).
   * Không có sản phẩm → bỏ qua.
   */
  async findCategoryIdsByBlockCodes(
    blockCodes: readonly string[],
  ): Promise<Map<string, string>> {
    const products = await this.products.findByBlockCodes(blockCodes);
    return new Map(products.map((p) => [p.blockCode, p.categoryId]));
  }

  // ---------- File sản phẩm ----------

  /**
   * Thay ảnh đại diện sản phẩm của mình: PNG/JPEG/WebP ≤ 5 MB (nhận diện bằng magic bytes).
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `INVALID_IMAGE_FILE`
   * @throws NotFoundError `PRODUCT_NOT_FOUND`
   */
  async uploadThumbnail(
    id: string,
    actor: AuthUser,
    file: UploadedFileData,
  ): Promise<Product> {
    const ext = this.detectImageExtension(file.buffer);
    if (!ext) throw invalidImageFile();
    return this.replaceProductFile(id, actor, {
      key: `products/${id}/thumbnail-${this.clock.now().getTime()}.${ext}`,
      data: file.buffer,
      apply: (product, key) => product.replaceThumbnail(key),
    });
  }

  /**
   * Thay model 3D sản phẩm của mình: glTF binary (.glb) ≤ 25 MB (kiểm tra header).
   * @throws ForbiddenError `SUPPLIER_PROFILE_MISSING`
   * @throws BusinessRuleError `SUPPLIER_NOT_ACTIVE` | `INVALID_MODEL_FILE`
   * @throws NotFoundError `PRODUCT_NOT_FOUND`
   */
  async uploadModel3d(
    id: string,
    actor: AuthUser,
    file: UploadedFileData,
  ): Promise<Product> {
    if (!this.isGlb(file.buffer)) throw invalidModelFile();
    return this.replaceProductFile(id, actor, {
      key: `products/${id}/model-3d-${this.clock.now().getTime()}.glb`,
      data: file.buffer,
      apply: (product, key) => product.replaceModel3d(key),
    });
  }

  /**
   * Ảnh: ai xem được sản phẩm thì tải được. Model 3D: chỉ Supplier chủ sản phẩm và Designer.
   * @throws NotFoundError `PRODUCT_NOT_FOUND` | `PRODUCT_FILE_NOT_FOUND`
   * @throws ForbiddenError `MODEL_3D_FORBIDDEN`
   */
  async downloadFile(
    id: string,
    kind: ProductFileKind,
    actor: AuthUser,
  ): Promise<ProductFile> {
    const product = await this.getProduct(id, actor);
    if (kind === 'model-3d' && !product.isModel3dVisibleTo(actor)) {
      throw new ForbiddenError(
        'MODEL_3D_FORBIDDEN',
        'Chỉ Supplier chủ sản phẩm và Designer được tải model 3D',
      );
    }
    return this.readFile(product, kind);
  }

  // ---------- Dùng chung với module designs ----------

  /** Sản phẩm chọn được cho món (ACTIVE, supplier đang hợp tác) của một danh mục, rẻ trước; kèm supplier. */
  searchChoosableByCategory(
    categoryId: string,
    page: PageRequest,
  ): Promise<Paginated<Product>> {
    return this.products.findChoosableByCategory(categoryId, page);
  }

  /** Sản phẩm chọn được theo id / `block_code`; không có hoặc đang ngừng bán → không có trong kết quả. */
  findChoosable(filter: {
    ids?: readonly string[];
    blockCodes?: readonly string[];
  }): Promise<Product[]> {
    return this.products.findChoosable(filter);
  }

  /**
   * File của sản phẩm (ảnh / model 3D .glb), **không kiểm role**: nơi gọi phải tự kiểm quyền
   * (module designs cho mọi người xem được dự án tải file của sản phẩm đang chọn / lựa chọn của món).
   * @throws NotFoundError `PRODUCT_NOT_FOUND` | `PRODUCT_FILE_NOT_FOUND`
   */
  async readProductFile(
    productId: string,
    kind: ProductFileKind,
  ): Promise<ProductFile> {
    return this.readFile(await this.getProductOrThrow(productId), kind);
  }

  // ---------- Private ----------

  /** @throws NotFoundError `PRODUCT_FILE_NOT_FOUND` */
  private async readFile(
    product: Product,
    kind: ProductFileKind,
  ): Promise<ProductFile> {
    const key =
      kind === 'thumbnail' ? product.thumbnailKey : product.model3dKey;
    const data = key ? await this.storage.read(key) : null;
    if (!key || !data) {
      throw new NotFoundError(
        'PRODUCT_FILE_NOT_FOUND',
        'Sản phẩm chưa có file này',
        { productId: product.id, kind },
      );
    }
    const ext = extensionOf(key);
    return {
      data,
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      fileName: `${product.sku}-${kind}.${ext}`,
    };
  }

  /**
   * Lưu file mới lên storage (ngoài transaction) → ghi khóa vào DB → commit xong mới xóa file cũ.
   * Ghi DB lỗi thì xóa file vừa lưu. Xóa file lỗi chỉ ghi log (file mồ côi, không ảnh hưởng dữ liệu).
   */
  private async replaceProductFile(
    id: string,
    actor: AuthUser,
    upload: {
      key: string;
      data: Buffer;
      /** Gắn khóa mới vào entity, trả khóa cũ. */
      apply: (product: Product, key: string) => string | null;
    },
  ): Promise<Product> {
    const supplierId = await this.catalog.getActiveSupplierId(actor);
    const current = await this.getProductOrThrow(id);
    if (current.supplierId !== supplierId) throw this.productNotFound(id);

    await this.storage.save(
      upload.key,
      upload.data,
      CONTENT_TYPES[extensionOf(upload.key)],
    );

    let previousKey: string | null;
    try {
      previousKey = await this.uow.run(async () => {
        const product = await this.products.findByIdForUpdate(id);
        if (!product || product.supplierId !== supplierId) {
          throw this.productNotFound(id);
        }
        const previous = upload.apply(product, upload.key);
        await this.products.saveFileKeys(product);
        return previous;
      });
    } catch (error) {
      await this.deleteFileQuietly(upload.key);
      throw error;
    }

    if (previousKey && previousKey !== upload.key) {
      await this.deleteFileQuietly(previousKey);
    }
    return this.getProductOrThrow(id);
  }

  private async deleteFileQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Không xóa được file ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Nhận diện ảnh theo magic bytes. Không nhận diện được hoặc quá 5 MB → `null`. */
  private detectImageExtension(data: Buffer): string | null {
    if (data.length > MAX_THUMBNAIL_BYTES) return null;
    if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return 'png';
    }
    if (data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
      return 'jpg';
    }
    if (
      data.length >= 12 &&
      data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'webp';
    }
    return null;
  }

  /** Header glTF binary v2 hợp lệ, `length` khai báo khớp kích thước file, ≤ 25 MB. */
  private isGlb(data: Buffer): boolean {
    return (
      data.length >= GLB_HEADER_BYTES &&
      data.length <= MAX_MODEL_3D_BYTES &&
      data.subarray(0, GLB_MAGIC.length).equals(GLB_MAGIC) &&
      data.readUInt32LE(4) === GLB_VERSION &&
      data.readUInt32LE(8) === data.length
    );
  }

  private async getProductOrThrow(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw this.productNotFound(id);
    return product;
  }

  private productNotFound(id: string): NotFoundError {
    return new NotFoundError('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm', {
      productId: id,
    });
  }

  private skuTaken(sku: string | undefined): ConflictError {
    return new ConflictError(
      'PRODUCT_SKU_EXISTS',
      'Mã SKU đã tồn tại trong catalog của bạn',
      { sku },
    );
  }

  private canViewProduct(product: Product, actor: AuthUser): boolean {
    switch (actor.role) {
      case 'ADMIN':
        return true;
      case 'SUPPLIER':
        return product.supplierId === actor.id;
      case 'DESIGNER':
      case 'STAFF':
        return product.isVisibleToBuyers();
      default:
        return false;
    }
  }

  /**
   * @throws NotFoundError `DESIGN_STYLE_NOT_FOUND`
   * @throws BusinessRuleError `DESIGN_STYLE_INACTIVE`
   */
  private async assertActiveStyles(styleIds: readonly string[]): Promise<void> {
    const found = await this.styles.findByIds(styleIds);
    const foundIds = new Set(found.map((s) => s.id));
    const missing = styleIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError(
        'DESIGN_STYLE_NOT_FOUND',
        'Không tìm thấy phong cách thiết kế',
        { styleIds: missing },
      );
    }
    const inactive = found.filter((s) => !s.isActive).map((s) => s.id);
    if (inactive.length > 0) {
      throw new BusinessRuleError(
        'DESIGN_STYLE_INACTIVE',
        'Phong cách thiết kế đang bị ẩn',
        { styleIds: inactive },
      );
    }
  }
}

function extensionOf(key: string): string {
  return key.slice(key.lastIndexOf('.') + 1);
}
