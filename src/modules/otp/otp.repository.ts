import { Injectable } from '@nestjs/common';
import { IsNull, MoreThan } from 'typeorm';
import { TransactionContext } from '../../database/transaction-context.js';
import {
  OtpVerification,
  type OtpPurpose,
} from './entities/otp-verification.entity.js';

export type NewOtp = Pick<
  OtpVerification,
  'userId' | 'purpose' | 'channel' | 'codeHash' | 'expiresAt' | 'createdAt'
>;

/** Bản ghi cùng `created_at`: OTP còn hạn dài hơn là bản mới (bản cũ đã bị cắt `expires_at`). */
const NEWEST_FIRST = { createdAt: 'DESC', expiresAt: 'DESC' } as const;

/** `otp_verifications`. Không có `delete`: OTP chỉ hết hạn hoặc được xác thực. */
@Injectable()
export class OtpRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(OtpVerification);
  }

  create(otp: NewOtp): Promise<OtpVerification> {
    return this.repo.save(
      this.repo.create({ ...otp, attemptCount: 0, verifiedAt: null }),
    );
  }

  /** OTP mới nhất (theo `created_at`) của user + purpose, kể cả đã dùng/hết hạn. */
  findLatest(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<OtpVerification | null> {
    return this.repo.findOne({
      where: { userId, purpose },
      order: NEWEST_FIRST,
    });
  }

  /** OTP chưa xác thực mới nhất của user + purpose (có thể đã hết hạn). */
  findLatestUnverified(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<OtpVerification | null> {
    return this.repo.findOne({
      where: { userId, purpose, verifiedAt: IsNull() },
      order: NEWEST_FIRST,
    });
  }

  /** Cho các OTP chưa dùng và còn hạn hết hạn ngay tại `at`. Trả số bản ghi bị ảnh hưởng. */
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

  /** Tăng `attempt_count` nguyên tử. Trả giá trị mới, `null` nếu không tìm thấy. */
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

  /** Đặt `verified_at` nếu chưa xác thực. `false` nếu OTP đã được dùng hoặc không tồn tại. */
  async markVerified(id: string, at: Date): Promise<boolean> {
    const result = await this.repo.update(
      { id, verifiedAt: IsNull() },
      { verifiedAt: at },
    );
    return (result.affected ?? 0) > 0;
  }
}
