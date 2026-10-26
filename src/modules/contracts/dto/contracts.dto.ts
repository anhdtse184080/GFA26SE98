import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/validation/optional.js';
import {
  POSITIVE_MONEY_PATTERN,
  toMoneyString,
  trim,
} from '../../../common/validation/transforms.js';
import {
  MILESTONE_DUE_TRIGGERS,
  MILESTONE_STAGE_TYPES,
  type MilestoneDueTrigger,
  type MilestoneStageType,
} from '../entities/payment-milestone.entity.js';

const MONEY_MESSAGE =
  'phải > 0, tối đa 13 chữ số phần nguyên và 2 chữ số thập phân';
/** Tối đa 4 đợt: mỗi `stageType` một đợt. */
const MAX_MILESTONES = MILESTONE_STAGE_TYPES.length;

export class PaymentMilestoneDto {
  /** Thứ tự đợt, liên tiếp từ 1 (đợt 1 là DEPOSIT) */
  @IsInt()
  @Min(1)
  @Max(MAX_MILESTONES)
  seqNo: number;

  /** @example Đặt cọc */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsIn(MILESTONE_STAGE_TYPES)
  stageType: MilestoneStageType;

  /**
   * Số tiền đợt (VND), > 0
   * @example 15000000
   */
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, { message: `amount ${MONEY_MESSAGE}` })
  amount: string;

  /** DEPOSIT → ON_CONTRACT_ACTIVE; các đợt khác → ON_STAGE_APPROVED */
  @IsIn(MILESTONE_DUE_TRIGGERS)
  dueTrigger: MilestoneDueTrigger;
}

export class CreateContractDto {
  /**
   * Phí thiết kế (VND), > 0; bằng tổng amount các đợt
   * @example 50000000
   */
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: `totalDesignFee ${MONEY_MESSAGE}`,
  })
  totalDesignFee: string;

  /** Số lượt yêu cầu sửa tối đa mỗi giai đoạn */
  @IsInt()
  @Min(0)
  @Max(20)
  maxRevisionsPerStage: number;

  /** Số ngày customer có để duyệt mỗi lần designer nộp */
  @IsInt()
  @Min(1)
  @Max(60)
  reviewWindowDays: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  note?: string;

  /** Lịch thanh toán theo hợp đồng */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MILESTONES)
  @ValidateNested({ each: true })
  @Type(() => PaymentMilestoneDto)
  milestones: PaymentMilestoneDto[];
}

/** PATCH (chỉ khi DRAFT, chưa gửi ký): bỏ field = giữ nguyên; `milestones` có mặt thì thay toàn bộ. */
export class UpdateContractDto {
  @IsOptionalNotNull()
  @Transform(toMoneyString)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: `totalDesignFee ${MONEY_MESSAGE}`,
  })
  totalDesignFee?: string;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(20)
  maxRevisionsPerStage?: number;

  @IsOptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(60)
  reviewWindowDays?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  note?: string | null;

  @IsOptionalNotNull()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MILESTONES)
  @ValidateNested({ each: true })
  @Type(() => PaymentMilestoneDto)
  milestones?: PaymentMilestoneDto[];
}
