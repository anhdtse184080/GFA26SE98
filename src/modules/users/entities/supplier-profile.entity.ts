import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import {
  PARTNERSHIP_STATUSES,
  type PartnershipStatus,
} from '../partnership-status.js';
import { assignDefined } from './assign-defined.js';
import { User } from './user.entity.js';

@Entity({ name: 'supplier_profiles' })
@Unique('uq_supplier_profiles_tax_code', ['taxCode'])
@Check(
  'chk_supplier_profiles_partnership_status',
  sqlIn('partnership_status', PARTNERSHIP_STATUSES),
)
export class SupplierProfile {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_supplier_profiles',
  })
  userId: string;

  @OneToOne(() => User, (user) => user.supplierProfile, { nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_supplier_profiles_user_id',
  })
  user?: Relation<User>;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'tax_code', type: 'varchar', length: 20 })
  taxCode: string;

  @Column({ name: 'business_address', type: 'varchar', length: 500 })
  businessAddress: string;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  contactName: string | null;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  contactPhone: string | null;

  @Column({ name: 'website', type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ name: 'partnership_status', type: 'varchar', length: 20 })
  partnershipStatus: PartnershipStatus;

  @Column({ name: 'partner_since', type: 'date', nullable: true })
  partnerSince: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Không đổi `partnership_status`. */
  update(patch: SupplierProfilePatch): void {
    assignDefined(this, patch);
  }
}

export type SupplierProfilePatch = Partial<
  Pick<
    SupplierProfile,
    | 'companyName'
    | 'taxCode'
    | 'businessAddress'
    | 'contactName'
    | 'contactPhone'
    | 'website'
    | 'partnerSince'
  >
>;
