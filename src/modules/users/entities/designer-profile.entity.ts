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
import { User } from './user.entity.js';

@Entity({ name: 'designer_profiles' })
@Unique('uq_designer_profiles_employee_code', ['employeeCode'])
@Check(
  'chk_designer_profiles_years_of_experience',
  `"years_of_experience" >= 0`,
)
@Check('chk_designer_profiles_rating_avg', `"rating_avg" BETWEEN 0 AND 5`)
@Check('chk_designer_profiles_rating_count', `"rating_count" >= 0`)
export class DesignerProfile {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_designer_profiles',
  })
  userId: string;

  @OneToOne(() => User, (user) => user.designerProfile, { nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_designer_profiles_user_id',
  })
  user?: Relation<User>;

  @Column({ name: 'employee_code', type: 'varchar', length: 20 })
  employeeCode: string;

  @Column({ name: 'title', type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({
    name: 'specialization',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  specialization: string | null;

  @Column({ name: 'years_of_experience', type: 'smallint', nullable: true })
  yearsOfExperience: number | null;

  @Column({ name: 'bio', type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable: boolean;

  /** NUMERIC(3,2): TypeORM trả string, tính toán bằng decimal.js. */
  @Column({
    name: 'rating_avg',
    type: 'numeric',
    precision: 3,
    scale: 2,
    default: 0,
  })
  ratingAvg: string;

  @Column({ name: 'rating_count', type: 'integer', default: 0 })
  ratingCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Không đổi `is_available` (endpoint riêng). */
  update(patch: DesignerProfilePatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
  }

  setAvailability(isAvailable: boolean): void {
    this.isAvailable = isAvailable;
  }
}

export type DesignerProfilePatch = Partial<
  Pick<
    DesignerProfile,
    'employeeCode' | 'title' | 'specialization' | 'yearsOfExperience' | 'bio'
  >
>;
