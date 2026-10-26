import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { TransactionContext } from '../../database/transaction-context.js';
import { RevisionRequest } from './entities/revision-request.entity.js';

/** `revision_requests`: log trao đổi, không có `delete`. */
@Injectable()
export class RevisionRequestsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(RevisionRequest);
  }

  /** Yêu cầu còn chờ xử lý (OPEN, IN_PROGRESS) của version. */
  findPendingByVersion(designVersionId: string): Promise<RevisionRequest[]> {
    return this.repo.find({
      where: { designVersionId, status: In(['OPEN', 'IN_PROGRESS']) },
    });
  }

  save(request: RevisionRequest): Promise<RevisionRequest> {
    return this.repo.save(request);
  }

  async saveAll(requests: readonly RevisionRequest[]): Promise<void> {
    if (requests.length > 0) await this.repo.save([...requests]);
  }
}
