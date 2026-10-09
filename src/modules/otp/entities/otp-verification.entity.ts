import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { User } from '../../users/entities/user.entity.js';
import {
  OTP_CHANNELS,
  OTP_PURPOSES,
  type OtpChannel,
  type OtpPurpose,
} from '../otp.enum.js';

@Entity({ name: 'otp_verifications' })
@Index('idx_otp_verifications_user_id_purpose', ['userId', 'purpose'])
@Check('chk_otp_verifications_purpose', sqlIn('purpose', OTP_PURPOSES))
@Check('chk_otp_verifications_channel', sqlIn('channel', OTP_CHANNELS))
@Check('chk_otp_verifications_attempt_count', `"attempt_count" >= 0`)
export class OtpVerification {
  @PrimaryGeneratedColumn('uuid', {
    name: 'id',
    primaryKeyConstraintName: 'pk_otp_verifications',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_otp_verifications_user_id',
  })
  user?: Relation<User>;

  @Column({ name: 'purpose', type: 'varchar', length: 30 })
  purpose: OtpPurpose;

  @Column({ name: 'channel', type: 'varchar', length: 10 })
  channel: OtpChannel;

  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'attempt_count', type: 'smallint', default: 0 })
  attemptCount: number;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
