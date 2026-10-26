import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { User } from '../../users/entities/user.entity.js';
import { Contract } from './contract.entity.js';

export const SIGNER_ROLES = ['CUSTOMER', 'COMPANY'] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

/**
 * Bằng chứng một bên đã ký hợp đồng (mỗi bên tối đa 1 dòng). Chỉ thêm mới, không sửa, không xóa.
 * `CUSTOMER` = `projects.customer_id`; `COMPANY` = Staff phụ trách dự án ký thay công ty.
 */
@Entity({ name: 'contract_signatures' })
@Unique('uq_contract_signatures_contract_id_signer_role', [
  'contractId',
  'signerRole',
])
@Index('idx_contract_signatures_signer_id', ['signerId'])
@Check(
  'chk_contract_signatures_signer_role',
  sqlIn('signer_role', SIGNER_ROLES),
)
export class ContractSignature {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_contract_signatures',
  })
  id: string;

  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @ManyToOne(() => Contract, { nullable: false })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'fk_contract_signatures_contract_id',
  })
  contract?: Relation<Contract>;

  @Column({ name: 'signer_id', type: 'uuid' })
  signerId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'signer_id',
    foreignKeyConstraintName: 'fk_contract_signatures_signer_id',
  })
  signer?: Relation<User>;

  @Column({ name: 'signer_role', type: 'varchar', length: 10 })
  signerRole: SignerRole;

  @Column({ name: 'signer_name_snapshot', type: 'varchar', length: 150 })
  signerNameSnapshot: string;

  @Column({ name: 'signer_email_snapshot', type: 'varchar', length: 255 })
  signerEmailSnapshot: string;

  /** SHA-256 (hex) của PDF chưa ký tại thời điểm ký. */
  @Column({ name: 'document_hash', type: 'varchar', length: 64 })
  documentHash: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent: string | null;

  @Column({ name: 'signed_at', type: 'timestamptz' })
  signedAt: Date;
}
