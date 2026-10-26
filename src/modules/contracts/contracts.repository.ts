import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { Contract } from './entities/contract.entity.js';
import { PaymentMilestone } from './entities/payment-milestone.entity.js';

export type NewContract = Pick<
  Contract,
  | 'projectId'
  | 'contractNo'
  | 'totalDesignFee'
  | 'maxRevisionsPerStage'
  | 'reviewWindowDays'
  | 'note'
  | 'createdById'
  | 'status'
  | 'esignStatus'
>;

export type NewMilestone = Pick<
  PaymentMilestone,
  'seqNo' | 'name' | 'stageType' | 'amount' | 'dueTrigger' | 'status'
>;

/** Kết quả tạo hợp đồng: bản ghi mới, hoặc constraint UNIQUE bị trùng. */
export type CreateContractResult =
  { contract: Contract } | { conflict: 'projectId' | 'contractNo' };

/**
 * `contracts` + `payment_milestones` + `contract_signatures` (bảng con ghi cùng hợp đồng).
 * Không có `delete` cho `contracts`, `contract_signatures`: hợp đồng kết thúc bằng `CANCELLED`/`COMPLETED`.
 */
@Injectable()
export class ContractsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(Contract);
  }

  private get milestoneRepo() {
    return this.tx.manager.getRepository(PaymentMilestone);
  }

  /** Kèm `milestones` theo `seq_no` tăng dần. */
  findById(id: string): Promise<Contract | null> {
    return this.repo.findOne({
      where: { id },
      relations: { milestones: true },
      order: { milestones: { seqNo: 'ASC' } },
    });
  }

  /** Kèm `milestones` theo `seq_no` tăng dần. */
  findByProjectId(projectId: string): Promise<Contract | null> {
    return this.repo.findOne({
      where: { projectId },
      relations: { milestones: true },
      order: { milestones: { seqNo: 'ASC' } },
    });
  }

  /** Khóa dòng hợp đồng đến hết transaction; không kèm quan hệ. */
  findByIdForUpdate(id: string): Promise<Contract | null> {
    return this.repo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  existsByContractNo(contractNo: string): Promise<boolean> {
    return this.repo.exists({ where: { contractNo } });
  }

  /**
   * Tạo hợp đồng kèm lịch thanh toán. Trùng `project_id` / `contract_no` → `conflict`
   * (transaction hiện tại đã hỏng, service phải ném lỗi để rollback).
   */
  async create(
    contract: NewContract,
    milestones: readonly NewMilestone[],
  ): Promise<CreateContractResult> {
    try {
      const saved = await this.repo.save(this.repo.create(contract));
      await this.insertMilestones(saved.id, milestones);
      return { contract: saved };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_contracts_project_id')) {
        return { conflict: 'projectId' };
      }
      if (isUniqueViolation(error, 'uq_contracts_contract_no')) {
        return { conflict: 'contractNo' };
      }
      throw error;
    }
  }

  /** Ghi điều khoản. `milestones` có mặt thì thay toàn bộ lịch thanh toán; `undefined` thì giữ nguyên. */
  async saveTerms(
    contract: Contract,
    milestones?: readonly NewMilestone[],
  ): Promise<void> {
    await this.repo.update(
      { id: contract.id },
      {
        totalDesignFee: contract.totalDesignFee,
        maxRevisionsPerStage: contract.maxRevisionsPerStage,
        reviewWindowDays: contract.reviewWindowDays,
        note: contract.note,
      },
    );
    if (milestones) {
      await this.milestoneRepo.delete({ contractId: contract.id });
      await this.insertMilestones(contract.id, milestones);
    }
  }

  async saveUnsignedFile(contract: Contract): Promise<void> {
    await this.repo.update(
      { id: contract.id },
      {
        unsignedFileKey: contract.unsignedFileKey,
        unsignedFileName: contract.unsignedFileName,
        unsignedFileHash: contract.unsignedFileHash,
      },
    );
  }

  private async insertMilestones(
    contractId: string,
    milestones: readonly NewMilestone[],
  ): Promise<void> {
    if (milestones.length === 0) return;
    await this.milestoneRepo.insert(
      milestones.map((m) => ({ ...m, contractId })),
    );
  }
}
