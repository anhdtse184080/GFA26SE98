import { Injectable } from '@nestjs/common';
import { IsNull, MoreThan } from 'typeorm';
import { TransactionContext } from '../../../database/transaction-context.js';
import { OtpVerification } from '../entities/otp-verification.entity.js';
import type { OtpPurpose } from '../otp.enum.js';
import type { NewOtp, OtpRepository } from './otp.repository.js';

/** Bản ghi cùng `created_at`: OTP còn hạn dài hơn là bản mới (bản cũ đã bị cắt `expires_at`). */
const NEWEST_FIRST = { createdAt: 'DESC', expiresAt: 'DESC' } as const;

@Injectable()
export class TypeOrmOtpRepository implements OtpRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(OtpVerification);
  }

  create(otp: NewOtp): Promise<OtpVerification> {
    return this.repo.save(
      this.repo.create({ ...otp, attemptCount: 0, verifiedAt: null }),
    );
  }

  findLatest(userId: string, purpose: OtpPurpose) {
    return this.repo.findOne({
      where: { userId, purpose },
      order: NEWEST_FIRST,
    });
  }

  findLatestUnverified(userId: string, purpose: OtpPurpose) {
    return this.repo.findOne({
      where: { userId, purpose, verifiedAt: IsNull() },
      order: NEWEST_FIRST,
    });
  }

  async invalidatePending(
    userId: string,
    purpose: OtpPurpose,
    at: Date,
  ): Promise<number> {
    const result = await this.repo.update(
      { userId, purpose, verifiedAt: IsNull(), expiresAt: MoreThan(at) },
      { expiresAt: at },
    );
    return result.affected ?? 0;
  }

  async incrementAttempts(id: string): Promise<number | null> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({ attemptCount: () => 'attempt_count + 1' })
      .where('id = :id', { id })
      .returning(['attempt_count'])
      .execute();
    const rows = result.raw as { attempt_count: number }[];
    return rows.length > 0 ? rows[0].attempt_count : null;
  }

  async markVerified(id: string, at: Date): Promise<boolean> {
    const result = await this.repo.update(
      { id, verifiedAt: IsNull() },
      { verifiedAt: at },
    );
    return (result.affected ?? 0) > 0;
  }
}
