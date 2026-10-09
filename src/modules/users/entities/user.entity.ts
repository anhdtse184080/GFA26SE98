import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { BusinessRuleError } from '../../../common/errors/index.js';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import {
  canTransitionUserStatus,
  USER_STATUSES,
  type UserStatus,
} from '../user-status.js';
import { DesignerProfile } from './designer-profile.entity.js';
import { Role } from './role.entity.js';
import { SupplierProfile } from './supplier-profile.entity.js';

/** Email luôn lưu chữ thường (CHECK) để UQ không phân biệt hoa thường. */
@Entity({ name: 'users' })
@Unique('uq_users_email', ['email'])
@Index('idx_users_role_id', ['roleId'])
@Check('chk_users_status', sqlIn('status', USER_STATUSES))
@Check('chk_users_email_lowercase', `"email" = lower("email")`)
export class User {
  @PrimaryGeneratedColumn('uuid', {
    name: 'id',
    primaryKeyConstraintName: 'pk_users',
  })
  id: string;

  @Column({ name: 'role_id', type: 'smallint' })
  roleId: number;

  @ManyToOne(() => Role, { nullable: false })
  @JoinColumn({ name: 'role_id', foreignKeyConstraintName: 'fk_users_role_id' })
  role?: Relation<Role>;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  email: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash: string | null;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @Column({ name: 'phone', type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: UserStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_users_created_by',
  })
  createdBy?: Relation<User> | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Chỉ được nạp khi repository yêu cầu (`findByIdWithProfiles`). */
  @OneToOne(() => DesignerProfile, (profile) => profile.user)
  designerProfile?: Relation<DesignerProfile> | null;

  @OneToOne(() => SupplierProfile, (profile) => profile.user)
  supplierProfile?: Relation<SupplierProfile> | null;

  /** INVITED → ACTIVE khi xác thực OTP. */
  activate(at: Date): void {
    this.transitionTo('ACTIVE');
    this.activatedAt = at;
  }

  recordLogin(at: Date): void {
    this.lastLoginAt = at;
  }

  /** Đặt lại mật khẩu (hash đã tính sẵn). Điều kiện trạng thái do service kiểm tra. */
  changePassword(passwordHash: string): void {
    this.passwordHash = passwordHash;
  }

  private transitionTo(to: UserStatus): void {
    if (!canTransitionUserStatus(this.status, to)) {
      throw new BusinessRuleError(
        'INVALID_USER_STATUS_TRANSITION',
        `Không thể chuyển trạng thái tài khoản từ ${this.status} sang ${to}`,
        { from: this.status, to },
      );
    }
    this.status = to;
  }
}
