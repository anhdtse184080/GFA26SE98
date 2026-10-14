import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  toBoolean,
  trim,
  trimUpperCase,
} from '../../../common/validation/transforms.js';
import {
  PRODUCT_STATUSES,
  PRODUCT_UNITS,
  type ProductStatus,
  type ProductUnit,
  STOCK_STATUSES,
  type StockStatus,
} from '../entities/product.entity.js';

export class ListCategoriesQueryDto {
  /** Lọc theo trạng thái; bỏ trống = tất cả */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/** Admin xem danh mục của mọi supplier. */
export class AdminListCategoriesQueryDto extends PaginationQueryDto {
  /** `user_id` của supplier */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  /** Tìm theo mã hoặc tên danh mục */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateCategoryDto {
  /** Danh mục cha (phải thuộc catalog của bạn); bỏ trống = danh mục gốc */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  /**
   * Mã duy nhất trong catalog của bạn (tự viết hoa)
   * @example SOFA
   */
  @Transform(trimUpperCase)
  @IsString()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @MaxLength(50)
  code: string;

  /** @example Sofa */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  /** Mặc định true */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** PATCH: bỏ field = giữ nguyên. `parentId: null` = chuyển thành danh mục gốc. Không đổi `code`. */
export class UpdateCategoryDto {
  /** Không được là chính nó hoặc danh mục con cháu của nó (→ 422 CATEGORY_CYCLE) */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  /** @example Sofa */
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  /** false = ẩn (thay cho xóa) */
  @IsOptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

// ---------- Products ----------

/** Số tiền ≥ 0, tối đa 13 chữ số phần nguyên và 2 chữ số thập phân (NUMERIC(15,2)). */
const MONEY_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;
/** Như `MONEY_PATTERN` nhưng > 0. */
const POSITIVE_MONEY_PATTERN = /^(?!0+(\.0{1,2})?$)\d{1,13}(\.\d{1,2})?$/;
const PRICE_MESSAGE =
  'price phải > 0, tối đa 13 chữ số phần nguyên và 2 chữ số thập phân';

/** Mã SKU: chữ, số, `.`, `_`, `-`. */
const SKU_PATTERN = /^[A-Za-z0-9._-]+$/;
const SKU_MESSAGE = 'sku chỉ gồm chữ, số và các ký tự . _ -';
const COLOR_CODE_PATTERN = /^#[0-9A-Fa-f]{6}$/;
/** Đường dẫn (bỏ query/hash) kết thúc bằng `.glb` hoặc `.gltf`. */
const MODEL_3D_PATH_PATTERN = /^[^?#]*\.(glb|gltf)([?#].*)?$/i;
const MAX_STYLES_PER_PRODUCT = 20;

/** Tiền nhận string (khuyến nghị, giữ chính xác) hoặc number; regex kiểm tra sau. */
const toMoneyString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : trim({ value });

export class ListProductsQueryDto extends PaginationQueryDto {
  /** Tìm theo tên hoặc sku */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  styleId?: string;

  /** `user_id` của supplier (Admin/Designer/Staff; Supplier luôn chỉ xem sản phẩm của mình) */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** @example 1000000 */
  @IsOptional()
  @Transform(trim)
  @Matches(MONEY_PATTERN, { message: 'minPrice không hợp lệ' })
  minPrice?: string;

  /** @example 20000000 */
  @IsOptional()
  @Transform(trim)
  @Matches(MONEY_PATTERN, { message: 'maxPrice không hợp lệ' })
  maxPrice?: string;

  @IsOptional()
  @IsIn(STOCK_STATUSES)
  stockStatus?: StockStatus;

  /** Designer/Staff chỉ thấy ACTIVE dù lọc gì */
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

export class CreateProductDto {
  /** Danh mục đang hoạt động trong catalog của bạn */
  @IsUUID()
  categoryId: string;

  /**
   * Duy nhất trong catalog của bạn
   * @example SOFA-JP-001
   */
  @Transform(trim)
  @IsString()
  @Matches(SKU_PATTERN, { message: SKU_MESSAGE })
  @MaxLength(50)
  sku: string;

  /** @example Sofa gỗ sồi Japandi 3 chỗ */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  material?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  colorName?: string;

  /** @example #C8B49A */
  @IsOptional()
  @Matches(COLOR_CODE_PATTERN, { message: 'colorCode phải dạng #RRGGBB' })
  colorCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  widthMm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  depthMm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  heightMm?: number;

  @IsIn(PRODUCT_UNITS)
  unit: ProductUnit;

  /**
   * VND, > 0, tối đa 2 chữ số thập phân (nên gửi dạng string)
   * @example "15900000.00"
   */
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, { message: PRICE_MESSAGE })
  price: string;

  @IsIn(STOCK_STATUSES)
  stockStatus: StockStatus;

  /** @example https://cdn.example.com/products/sofa.jpg */
  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true }, { message: 'thumbnailUrl không hợp lệ' })
  @MaxLength(500)
  thumbnailUrl?: string;

  /**
   * HTTPS, file .glb hoặc .gltf
   * @example https://cdn.example.com/products/sofa.glb
   */
  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'model3dUrl phải là URL https' },
  )
  @Matches(MODEL_3D_PATH_PATTERN, {
    message: 'model3dUrl phải trỏ tới file .glb hoặc .gltf',
  })
  @MaxLength(500)
  model3dUrl?: string;

  /** Thông số kỹ thuật tự do (JSON object) */
  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown>;

  /** Phong cách đang hoạt động; mặc định không có */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_STYLES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  styleIds?: string[];

  /** Mặc định ACTIVE */
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

/**
 * PATCH: bỏ field = giữ nguyên; `null` = xóa (chỉ field không bắt buộc).
 * `styleIds` có mặt thì thay toàn bộ phong cách. Ngừng bán: `status: "INACTIVE"`.
 */
export class UpdateProductDto {
  @IsOptionalNotNull()
  @IsUUID()
  categoryId?: string;

  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @Matches(SKU_PATTERN, { message: SKU_MESSAGE })
  @MaxLength(50)
  sku?: string;

  @IsOptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  material?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  colorName?: string | null;

  @IsOptional()
  @Matches(COLOR_CODE_PATTERN, { message: 'colorCode phải dạng #RRGGBB' })
  colorCode?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  widthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  depthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  heightMm?: number | null;

  @IsOptionalNotNull()
  @IsIn(PRODUCT_UNITS)
  unit?: ProductUnit;

  /** @example "14500000" */
  @IsOptionalNotNull()
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, { message: PRICE_MESSAGE })
  price?: string;

  @IsOptionalNotNull()
  @IsIn(STOCK_STATUSES)
  stockStatus?: StockStatus;

  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true }, { message: 'thumbnailUrl không hợp lệ' })
  @MaxLength(500)
  thumbnailUrl?: string | null;

  /** HTTPS, file .glb hoặc .gltf */
  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'model3dUrl phải là URL https' },
  )
  @Matches(MODEL_3D_PATH_PATTERN, {
    message: 'model3dUrl phải trỏ tới file .glb hoặc .gltf',
  })
  @MaxLength(500)
  model3dUrl?: string | null;

  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown> | null;

  /** Thay toàn bộ; `[]` = bỏ hết phong cách */
  @IsOptionalNotNull()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_STYLES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  styleIds?: string[];

  /** INACTIVE = ngừng bán (thay cho xóa) */
  @IsOptionalNotNull()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}
