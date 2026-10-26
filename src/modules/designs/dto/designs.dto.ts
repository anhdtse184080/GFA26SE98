import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { trim } from '../../../common/validation/transforms.js';
import {
  REVISION_TYPES,
  type RevisionType,
} from '../entities/design-version.entity.js';

const CONTENT_MAX_LENGTH = 2000;
/** Số món sửa tối đa trong một lần lưu. */
const MAX_EDITS = 500;

/** Chuỗi số từ multipart → number; giá trị khác giữ nguyên để @IsNumber báo 400. */
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  !Number.isNaN(Number(value))
    ? Number(value)
    : value;

/** Field text đi kèm file DXF (multipart/form-data, field file: `file`). */
export class UploadDesignVersionDto {
  /** @example Mặt bằng bố trí nội thất */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(CONTENT_MAX_LENGTH)
  description?: string;

  /** Bắt buộc từ bản thứ hai của giai đoạn; bản đầu tiên bỏ trống (chuỗi rỗng cũng coi như không gửi) */
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @IsIn(REVISION_TYPES)
  revisionType?: RevisionType;

  /**
   * Chiều cao tường (mét), mặc định 2.7
   * @example 2.7
   */
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(2.2)
  @Max(4.5)
  wallHeight?: number;
}

/** Điểm ghim trên mặt bằng (mét). */
export class PinPositionDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  x: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  y: number;
}

/**
 * Comment gốc: có `designElementId` = theo món; chỉ có `pinPosition` = chỗ trống; không có cả hai = comment chung.
 * Trả lời: chỉ `parentCommentId` + `content`.
 */
export class CreateCommentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CONTENT_MAX_LENGTH)
  content: string;

  @IsOptional()
  @IsUUID()
  designElementId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PinPositionDto)
  pinPosition?: PinPositionDto;

  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}

export const COMMENT_STATUS_ACTIONS = ['ADDRESS', 'ACCEPT', 'REOPEN'] as const;
export type CommentStatusAction = (typeof COMMENT_STATUS_ACTIONS)[number];

/**
 * - `ADDRESS` (Designer): OPEN → ADDRESSED, bắt buộc `addressedInVersionId`
 * - `ACCEPT` (Customer): ADDRESSED → RESOLVED
 * - `REOPEN` (Customer, "Not yet"): ADDRESSED → OPEN, bắt buộc `reply`
 */
export class UpdateCommentStatusDto {
  @IsIn(COMMENT_STATUS_ACTIONS)
  action: CommentStatusAction;

  @IsOptional()
  @IsUUID()
  addressedInVersionId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CONTENT_MAX_LENGTH)
  reply?: string;
}

/** Giai đoạn có version upload / chỉnh sửa (CONCEPT chưa làm). */
export const STAGE_VERSION_TYPES = ['LAYOUT_2D', 'RENDER_3D'] as const;
export type StageVersionType = (typeof STAGE_VERSION_TYPES)[number];

export class ListDesignVersionsQueryDto {
  /** Mặc định LAYOUT_2D */
  @IsOptional()
  @IsIn(STAGE_VERSION_TYPES)
  versionType?: StageVersionType;
}

export class ProductOptionsQueryDto extends PaginationQueryDto {}

export class ElementModelQueryDto {
  /** Bỏ trống = sản phẩm đang chọn cho món; có = một lựa chọn cùng danh mục */
  @IsOptional()
  @IsUUID()
  productId?: string;
}

export class ComparisonQueryDto {
  /** Version so với `:id` (cùng dự án, cùng giai đoạn) */
  @IsUUID()
  with: string;
}

export class ElementSelectionDto {
  @IsUUID()
  elementId: string;

  /** Sản phẩm cùng danh mục với món, đang bán */
  @IsUUID()
  productId: string;
}

export class ElementOverridesDto {
  @IsUUID()
  elementId: string;

  /**
   * Thuộc tính chỉnh trên web, thay toàn bộ `overrides` của món ({} = xóa hết)
   * @example { "mountHeight": 1.6, "on": true }
   */
  @IsObject()
  overrides: Record<string, unknown>;
}

/**
 * Lưu chỉnh sửa trên bản RENDER_3D hiện tại thành version mới. Bản nháp giữ ở frontend; chỉ gửi khi lưu.
 * Không thêm / xóa / dời món (sửa trong AutoCAD).
 */
export class SaveDesignEditDto {
  /** @example Đổi sofa sang mẫu vải sáng màu */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(CONTENT_MAX_LENGTH)
  description?: string;

  @IsIn(REVISION_TYPES)
  revisionType: RevisionType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EDITS)
  @ValidateNested({ each: true })
  @Type(() => ElementSelectionDto)
  selections?: ElementSelectionDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EDITS)
  @ValidateNested({ each: true })
  @Type(() => ElementOverridesDto)
  overrides?: ElementOverridesDto[];

  /** "Choose all remaining": món chưa chọn mà block trùng mã block của một sản phẩm đang bán → chọn sản phẩm đó */
  @IsOptional()
  @IsBoolean()
  chooseAllRemaining?: boolean;
}

export class CreateRevisionRequestDto {
  /** @example Phòng khách cần thêm chỗ để giày gần cửa */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CONTENT_MAX_LENGTH)
  content: string;
}
