import { randomUUID } from 'node:crypto';
import { OtpVerification } from '../entities/otp-verification.entity.js';
import type { OtpPurpose } from '../otp.enum.js';
import type { NewOtp, OtpRepository } from '../repositories/otp.repository.js';

/** Fake cho unit test: hành xử như TypeOrmOtpRepository, trả bản sao để test không sửa trực tiếp "DB". */
export class InMemoryOtpRepository implements OtpRepository {
  readonly rows: OtpVerification[] = [];

  create(otp: NewOtp): Promise<OtpVerification> {
    const row = Object.assign(new OtpVerification(), {
      ...otp,
      id: randomUUID(),
      attemptCount: 0,
      verifiedAt: null,
    });
    this.rows.push(row);
    return Promise.resolve(copy(row));
  }

  findLatest(userId: string, purpose: OtpPurpose) {
    return Promise.resolve(
      this.latest((r) => r.userId === userId && r.purpose === purpose),
    );
  }

  findLatestUnverified(userId: string, purpose: OtpPurpose) {
    return Promise.resolve(
      this.latest(
        (r) =>
          r.userId === userId && r.purpose === purpose && r.verifiedAt === null,
      ),
    );
  }

  invalidatePending(
    userId: string,
    purpose: OtpPurpose,
    at: Date,
  ): Promise<number> {
    const pending = this.rows.filter(
      (r) =>
        r.userId === userId &&
        r.purpose === purpose &&
        r.verifiedAt === null &&
        r.expiresAt.getTime() > at.getTime(),
    );
    for (const row of pending) row.expiresAt = new Date(at);
    return Promise.resolve(pending.length);
  }

  incrementAttempts(id: string): Promise<number | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return Promise.resolve(null);
    row.attemptCount += 1;
    return Promise.resolve(row.attemptCount);
  }

  markVerified(id: string, at: Date): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id && r.verifiedAt === null);
    if (!row) return Promise.resolve(false);
    row.verifiedAt = new Date(at);
    return Promise.resolve(true);
  }

  /** Cùng thứ tự với repository thật: created_at DESC, expires_at DESC. */
  private latest(
    match: (r: OtpVerification) => boolean,
  ): OtpVerification | null {
    const found = this.rows
      .filter(match)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.expiresAt.getTime() - a.expiresAt.getTime(),
      )[0];
    return found ? copy(found) : null;
  }
}

function copy(row: OtpVerification): OtpVerification {
  return Object.assign(new OtpVerification(), row, {
    expiresAt: new Date(row.expiresAt),
    createdAt: new Date(row.createdAt),
    verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
  });
}
