import type {
  Contract,
  ContractStatus,
  EsignStatus,
} from '../entities/contract.entity.js';
import type {
  MilestoneDueTrigger,
  MilestoneStageType,
  MilestoneStatus,
  PaymentMilestone,
} from '../entities/payment-milestone.entity.js';

export class PaymentMilestoneResponseDto {
  id: string;
  seqNo: number;
  name: string;
  stageType: MilestoneStageType;
  /** VND, dạng string 2 chữ số thập phân (vd "15000000.00") */
  amount: string;
  dueTrigger: MilestoneDueTrigger;
  status: MilestoneStatus;
  approvedVersionId: string | null;
  reviewDeadline: Date | null;
  autoApproved: boolean;
  approvedAt: Date | null;
  invoicedAt: Date | null;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  paidAt: Date | null;

  static from(m: PaymentMilestone): PaymentMilestoneResponseDto {
    return Object.assign(new PaymentMilestoneResponseDto(), {
      id: m.id,
      seqNo: m.seqNo,
      name: m.name,
      stageType: m.stageType,
      amount: m.amount,
      dueTrigger: m.dueTrigger,
      status: m.status,
      approvedVersionId: m.approvedVersionId,
      reviewDeadline: m.reviewDeadline,
      autoApproved: m.autoApproved,
      approvedAt: m.approvedAt,
      invoicedAt: m.invoicedAt,
      dueDate: m.dueDate,
      paidAt: m.paidAt,
    });
  }
}

/** Thông tin file PDF; nội dung tải qua `GET /contracts/:id/file`. */
export class ContractFileInfoDto {
  fileName: string;
}

export class UnsignedContractFileInfoDto extends ContractFileInfoDto {
  /** SHA-256 (hex) */
  hash: string;
}

export class ContractResponseDto {
  id: string;
  projectId: string;
  /** Dạng `HD-YYMMDD-XXXX` */
  contractNo: string;
  /** VND, dạng string 2 chữ số thập phân */
  totalDesignFee: string;
  maxRevisionsPerStage: number;
  reviewWindowDays: number;
  status: ContractStatus;
  esignStatus: EsignStatus;
  note: string | null;
  /** PDF chưa ký Staff upload; null = chưa upload */
  unsignedFile: UnsignedContractFileInfoDto | null;
  /** PDF đã ký do hệ thống sinh; null = chưa ký xong */
  signedFile: ContractFileInfoDto | null;
  /** `YYYY-MM-DD` (giờ Việt Nam) */
  signedDate: string | null;
  createdById: string;
  esignSentAt: Date | null;
  esignCompletedAt: Date | null;
  activatedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Theo `seqNo` tăng dần */
  milestones: PaymentMilestoneResponseDto[];

  /** `contract` phải được tải kèm `milestones`. Không trả khóa FileStorage. */
  static from(contract: Contract): ContractResponseDto {
    if (!contract.milestones) {
      throw new Error('Contract must be loaded with milestones');
    }
    return Object.assign(new ContractResponseDto(), {
      id: contract.id,
      projectId: contract.projectId,
      contractNo: contract.contractNo,
      totalDesignFee: contract.totalDesignFee,
      maxRevisionsPerStage: contract.maxRevisionsPerStage,
      reviewWindowDays: contract.reviewWindowDays,
      status: contract.status,
      esignStatus: contract.esignStatus,
      note: contract.note,
      unsignedFile:
        contract.unsignedFileName && contract.unsignedFileHash
          ? {
              fileName: contract.unsignedFileName,
              hash: contract.unsignedFileHash,
            }
          : null,
      signedFile: contract.signedFileName
        ? { fileName: contract.signedFileName }
        : null,
      signedDate: contract.signedDate,
      createdById: contract.createdById,
      esignSentAt: contract.esignSentAt,
      esignCompletedAt: contract.esignCompletedAt,
      activatedAt: contract.activatedAt,
      completedAt: contract.completedAt,
      cancelledAt: contract.cancelledAt,
      cancelReason: contract.cancelReason,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      milestones: contract.milestones.map((m) =>
        PaymentMilestoneResponseDto.from(m),
      ),
    });
  }
}
