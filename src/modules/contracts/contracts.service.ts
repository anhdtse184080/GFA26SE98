import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/index.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import {
  CONTRACT_PDF_RENDERER,
  type ContractPdfRenderer,
} from '../../common/ports/contract-pdf-renderer.js';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../../common/ports/file-storage.js';
import type { UploadedFileData } from '../../common/upload/single-file-upload.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  ContractsRepository,
  type NewMilestone,
} from './contracts.repository.js';
import type {
  Contract,
  ContractTermsPatch,
} from './entities/contract.entity.js';
import type {
  MilestoneDueTrigger,
  MilestoneStageType,
} from './entities/payment-milestone.entity.js';

export interface MilestoneInput {
  seqNo: number;
  name: string;
  stageType: MilestoneStageType;
  /** Chuỗi thập phân > 0, DTO đã kiểm tra định dạng. */
  amount: string;
  dueTrigger: MilestoneDueTrigger;
}

export interface CreateContractInput {
  totalDesignFee: string;
  maxRevisionsPerStage: number;
  reviewWindowDays: number;
  note: string | null;
  milestones: MilestoneInput[];
}

/** `undefined` = giữ nguyên. `milestones` có mặt thì thay toàn bộ lịch thanh toán. */
export type UpdateContractInput = ContractTermsPatch & {
  milestones?: MilestoneInput[];
};

/** File tải về: nội dung + metadata để controller dựng response. */
export interface ContractFile {
  data: Buffer;
  fileName: string;
}

export const MAX_CONTRACT_PDF_BYTES = 20 * 1024 * 1024;

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const CONTRACT_NO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONTRACT_NO_SUFFIX_LENGTH = 4;
const CONTRACT_NO_MAX_ATTEMPTS = 3;
/** Giờ Việt Nam (UTC+7) để số hợp đồng theo ngày địa phương. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_FILE_NAME_LENGTH = 255;

/** Dùng cả ở interceptor upload (multer chặn file vượt giới hạn). */
export function invalidPdfFile(
  message = 'Hợp đồng phải là file PDF đọc được, không mã hóa, tối đa 20 MB',
): BusinessRuleError {
  return new BusinessRuleError('INVALID_PDF_FILE', message, {
    allowedTypes: ['application/pdf'],
    maxBytes: MAX_CONTRACT_PDF_BYTES,
  });
}

/**
 * Hợp đồng thiết kế – phần soạn (DB_CONTEXT §4.3, §4.4, §6 quy tắc 4):
 * - Staff phụ trách tạo hợp đồng `DRAFT` kèm lịch thanh toán (dự án → `CONTRACT_PENDING`), sửa điều khoản,
 *   upload PDF chưa ký; chỉ khi `DRAFT` và `esign_status = NOT_SENT`.
 * - Ai xem được dự án thì xem được hợp đồng; riêng Customer chỉ thấy sau khi Staff gửi ký.
 * - File PDF: DB chỉ lưu khóa trên FileStorage; tải qua API có kiểm tra quyền.
 */
@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly contracts: ContractsRepository,
    private readonly projects: ProjectsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CONTRACT_PDF_RENDERER) private readonly pdf: ContractPdfRenderer,
  ) {}

  // ---------- Đọc ----------

  /** @throws NotFoundError `PROJECT_NOT_FOUND` | `CONTRACT_NOT_FOUND` */
  async getByProject(projectId: string, actor: AuthUser): Promise<Contract> {
    await this.projects.getAccessibleProject(projectId, actor);
    const contract = await this.contracts.findByProjectId(projectId);
    if (!contract || !this.isVisibleTo(contract, actor)) {
      throw this.contractNotFound({ projectId });
    }
    return contract;
  }

  /** @throws NotFoundError `CONTRACT_NOT_FOUND` */
  getById(id: string, actor: AuthUser): Promise<Contract> {
    return this.getViewableContract(id, actor);
  }

  /**
   * File đã ký nếu có, chưa có thì file chưa ký.
   * @throws NotFoundError `CONTRACT_NOT_FOUND` | `CONTRACT_FILE_NOT_FOUND`
   */
  async downloadFile(id: string, actor: AuthUser): Promise<ContractFile> {
    const contract = await this.getViewableContract(id, actor);
    const signed = contract.signedFileKey !== null;
    const key = contract.signedFileKey ?? contract.unsignedFileKey;
    const data = key ? await this.storage.read(key) : null;
    if (!data) {
      throw new NotFoundError(
        'CONTRACT_FILE_NOT_FOUND',
        'Hợp đồng chưa có file',
        { contractId: id },
      );
    }
    return {
      data,
      fileName: `${contract.contractNo}${signed ? '-signed' : ''}.pdf`,
    };
  }

  // ---------- Ghi ----------

  /**
   * Staff phụ trách tạo hợp đồng `DRAFT` kèm lịch thanh toán; dự án DRAFT → CONTRACT_PENDING (cùng transaction).
   * @throws NotFoundError `PROJECT_NOT_FOUND`
   * @throws ForbiddenError `NOT_PROJECT_STAFF`
   * @throws ConflictError `CONTRACT_ALREADY_EXISTS` | `CONTRACT_NO_GENERATION_FAILED`
   * @throws BusinessRuleError `INVALID_MILESTONES` | `MILESTONE_TOTAL_MISMATCH` | `INVALID_PROJECT_STATUS_TRANSITION`
   */
  async create(
    projectId: string,
    actor: AuthUser,
    input: CreateContractInput,
  ): Promise<Contract> {
    const project = await this.projects.getManagedProject(projectId, actor);
    if (await this.contracts.findByProjectId(project.id)) {
      throw this.contractAlreadyExists(project.id);
    }
    this.assertValidMilestones(input.totalDesignFee, input.milestones);

    for (let attempt = 0; attempt < CONTRACT_NO_MAX_ATTEMPTS; attempt++) {
      const contractNo = this.generateContractNo();
      if (await this.contracts.existsByContractNo(contractNo)) continue;

      const id = await this.uow.run(async () => {
        await this.projects.markContractPending(project.id);
        const result = await this.contracts.create(
          {
            projectId: project.id,
            contractNo,
            totalDesignFee: input.totalDesignFee,
            maxRevisionsPerStage: input.maxRevisionsPerStage,
            reviewWindowDays: input.reviewWindowDays,
            note: input.note,
            createdById: actor.id,
            status: 'DRAFT',
            esignStatus: 'NOT_SENT',
          },
          this.toNewMilestones(input.milestones),
        );
        if ('contract' in result) return result.contract.id;
        throw result.conflict === 'projectId'
          ? this.contractAlreadyExists(project.id)
          : this.contractNoGenerationFailed();
      });
      return this.getContractOrThrow(id);
    }
    throw this.contractNoGenerationFailed();
  }

  /**
   * Sửa điều khoản / thay toàn bộ lịch thanh toán; chỉ khi DRAFT và chưa gửi ký.
   * Tổng các đợt phải bằng phí thiết kế sau khi gộp thay đổi.
   * @throws NotFoundError `CONTRACT_NOT_FOUND`
   * @throws ForbiddenError `NOT_PROJECT_STAFF`
   * @throws BusinessRuleError `CONTRACT_NOT_EDITABLE` | `INVALID_MILESTONES` | `MILESTONE_TOTAL_MISMATCH`
   */
  async update(
    id: string,
    actor: AuthUser,
    input: UpdateContractInput,
  ): Promise<Contract> {
    await this.getManagedContract(id, actor);
    const { milestones, ...terms } = input;

    await this.uow.run(async () => {
      const contract = await this.contracts.findByIdForUpdate(id);
      if (!contract) throw this.contractNotFound({ contractId: id });
      contract.updateTerms(terms);
      const current = await this.getContractOrThrow(id);
      this.assertValidMilestones(
        contract.totalDesignFee,
        milestones ?? current.milestones ?? [],
      );
      await this.contracts.saveTerms(
        contract,
        milestones && this.toNewMilestones(milestones),
      );
    });
    return this.getContractOrThrow(id);
  }

  /**
   * Thay PDF chưa ký: kiểm tra định dạng (magic bytes + pdf-lib), lưu SHA-256; chỉ khi DRAFT và chưa gửi ký.
   * @throws NotFoundError `CONTRACT_NOT_FOUND`
   * @throws ForbiddenError `NOT_PROJECT_STAFF`
   * @throws BusinessRuleError `CONTRACT_NOT_EDITABLE` | `INVALID_PDF_FILE`
   */
  async uploadUnsignedFile(
    id: string,
    actor: AuthUser,
    file: UploadedFileData,
  ): Promise<Contract> {
    const current = await this.getManagedContract(id, actor);
    current.assertEditable();
    if (!(await this.isValidPdf(file.buffer))) throw invalidPdfFile();

    const key = `contracts/${id}/unsigned-${this.clock.now().getTime()}.pdf`;
    const upload = {
      key,
      name: this.normalizeFileName(file.originalname),
      hash: createHash('sha256').update(file.buffer).digest('hex'),
    };
    // Lưu file ngoài transaction → ghi khóa vào DB → commit xong mới xóa file cũ (ARCHITECTURE §5).
    await this.storage.save(key, file.buffer, 'application/pdf');

    let previousKey: string | null;
    try {
      previousKey = await this.uow.run(async () => {
        const contract = await this.contracts.findByIdForUpdate(id);
        if (!contract) throw this.contractNotFound({ contractId: id });
        const previous = contract.replaceUnsignedFile(upload);
        await this.contracts.saveUnsignedFile(contract);
        return previous;
      });
    } catch (error) {
      await this.deleteFileQuietly(key);
      throw error;
    }

    if (previousKey && previousKey !== key) {
      await this.deleteFileQuietly(previousKey);
    }
    return this.getContractOrThrow(id);
  }

  // ---------- Private ----------

  /** Người không xem được dự án / Customer khi chưa gửi ký → 404 (không lộ hợp đồng tồn tại). */
  private async getViewableContract(
    id: string,
    actor: AuthUser,
  ): Promise<Contract> {
    const contract = await this.getContractOrThrow(id);
    try {
      await this.projects.getAccessibleProject(contract.projectId, actor);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw this.contractNotFound({ contractId: id });
      }
      throw error;
    }
    if (!this.isVisibleTo(contract, actor)) {
      throw this.contractNotFound({ contractId: id });
    }
    return contract;
  }

  /** Staff phụ trách dự án của hợp đồng; không xem được dự án → 404, xem được nhưng không phụ trách → 403. */
  private async getManagedContract(
    id: string,
    actor: AuthUser,
  ): Promise<Contract> {
    const contract = await this.getContractOrThrow(id);
    try {
      await this.projects.getManagedProject(contract.projectId, actor);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw this.contractNotFound({ contractId: id });
      }
      throw error;
    }
    return contract;
  }

  private async getContractOrThrow(id: string): Promise<Contract> {
    const contract = await this.contracts.findById(id);
    if (!contract) throw this.contractNotFound({ contractId: id });
    return contract;
  }

  /** Customer chỉ thấy hợp đồng sau khi Staff gửi ký; các role khác theo quyền xem dự án. */
  private isVisibleTo(contract: Contract, actor: AuthUser): boolean {
    return actor.role !== 'CUSTOMER' || contract.esignStatus !== 'NOT_SENT';
  }

  /**
   * Lịch thanh toán (DB_CONTEXT §4.4): `seqNo` liên tiếp từ 1; mỗi `stageType` tối đa 1 đợt;
   * đúng 1 DEPOSIT ở đợt 1, phát hành khi kích hoạt hợp đồng; các đợt khác phát hành khi duyệt giai đoạn;
   * tổng `amount` = `totalDesignFee`.
   * @throws BusinessRuleError `INVALID_MILESTONES` | `MILESTONE_TOTAL_MISMATCH`
   */
  private assertValidMilestones(
    totalDesignFee: string,
    milestones: readonly Pick<
      MilestoneInput,
      'seqNo' | 'stageType' | 'amount' | 'dueTrigger'
    >[],
  ): void {
    const invalid = (message: string) =>
      new BusinessRuleError('INVALID_MILESTONES', message);
    if (milestones.length === 0) {
      throw invalid('Lịch thanh toán phải có ít nhất một đợt');
    }
    const sorted = [...milestones].sort((a, b) => a.seqNo - b.seqNo);
    sorted.forEach((m, index) => {
      if (m.seqNo !== index + 1) {
        throw invalid('seqNo phải liên tiếp từ 1, không trùng');
      }
    });
    const stageTypes = new Set(milestones.map((m) => m.stageType));
    if (stageTypes.size !== milestones.length) {
      throw invalid('Mỗi loại giai đoạn (stageType) chỉ có tối đa một đợt');
    }
    for (const m of sorted) {
      const isDeposit = m.stageType === 'DEPOSIT';
      if (isDeposit !== (m.seqNo === 1)) {
        throw invalid('Đợt 1 phải là DEPOSIT và chỉ có một đợt DEPOSIT');
      }
      const expected = isDeposit ? 'ON_CONTRACT_ACTIVE' : 'ON_STAGE_APPROVED';
      if (m.dueTrigger !== expected) {
        throw invalid(
          `Đợt ${m.seqNo} (${m.stageType}) phải có dueTrigger ${expected}`,
        );
      }
    }

    const total = milestones.reduce(
      (sum, m) => sum.plus(m.amount),
      new Decimal(0),
    );
    if (!total.equals(totalDesignFee)) {
      throw new BusinessRuleError(
        'MILESTONE_TOTAL_MISMATCH',
        'Tổng số tiền các đợt phải bằng phí thiết kế',
        {
          totalDesignFee: new Decimal(totalDesignFee).toFixed(2),
          milestonesTotal: total.toFixed(2),
        },
      );
    }
  }

  private toNewMilestones(
    milestones: readonly MilestoneInput[],
  ): NewMilestone[] {
    return milestones.map((m) => ({
      seqNo: m.seqNo,
      name: m.name,
      stageType: m.stageType,
      amount: m.amount,
      dueTrigger: m.dueTrigger,
      status: 'PENDING',
    }));
  }

  /** Header `%PDF-`, ≤ 20 MB, pdf-lib đọc được (không hỏng, không mã hóa). */
  private async isValidPdf(data: Buffer): Promise<boolean> {
    return (
      data.length <= MAX_CONTRACT_PDF_BYTES &&
      data.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE) &&
      (await this.pdf.isReadablePdf(data))
    );
  }

  /** Multer đọc tên file theo latin1; client gửi UTF-8 (tên tiếng Việt) → giải mã lại. */
  private normalizeFileName(originalName: string): string {
    const name = Buffer.from(originalName, 'latin1').toString('utf8').trim();
    return (name || 'contract.pdf').slice(0, MAX_FILE_NAME_LENGTH);
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

  /** `HD-YYMMDD-XXXX`, ngày theo giờ Việt Nam. */
  private generateContractNo(): string {
    const local = new Date(this.clock.now().getTime() + VN_OFFSET_MS);
    const yy = String(local.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    let suffix = '';
    for (let i = 0; i < CONTRACT_NO_SUFFIX_LENGTH; i++) {
      suffix += CONTRACT_NO_ALPHABET[randomInt(CONTRACT_NO_ALPHABET.length)];
    }
    return `HD-${yy}${mm}${dd}-${suffix}`;
  }

  private contractNotFound(details: Record<string, unknown>): NotFoundError {
    return new NotFoundError(
      'CONTRACT_NOT_FOUND',
      'Không tìm thấy hợp đồng',
      details,
    );
  }

  private contractAlreadyExists(projectId: string): ConflictError {
    return new ConflictError(
      'CONTRACT_ALREADY_EXISTS',
      'Dự án đã có hợp đồng',
      { projectId },
    );
  }

  private contractNoGenerationFailed(): ConflictError {
    return new ConflictError(
      'CONTRACT_NO_GENERATION_FAILED',
      'Không sinh được số hợp đồng duy nhất, vui lòng thử lại',
    );
  }
}
