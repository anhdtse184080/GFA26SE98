import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Room } from './room.entity.js';

/** Căn hộ chung cư của customer. `owner_id` không đổi sau khi tạo. */
@Entity({ name: 'apartments' })
@Index('idx_apartments_owner_id', ['ownerId'])
@Check('chk_apartments_net_area', '"net_area" > 0')
@Check('chk_apartments_bedroom_count', '"bedroom_count" >= 0')
@Check('chk_apartments_bathroom_count', '"bathroom_count" >= 0')
export class Apartment {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_apartments',
  })
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  /** Chỉ đọc (họ tên, email chủ căn). */
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'fk_apartments_owner_id',
  })
  owner?: Relation<User>;

  @Column({ name: 'building_name', type: 'varchar', length: 200 })
  buildingName: string;

  @Column({ name: 'address', type: 'varchar', length: 500 })
  address: string;

  @Column({ name: 'tower', type: 'varchar', length: 50, nullable: true })
  tower: string | null;

  @Column({ name: 'unit_no', type: 'varchar', length: 50 })
  unitNo: string;

  @Column({ name: 'floor_no', type: 'smallint', nullable: true })
  floorNo: number | null;

  @Column({ name: 'layout_code', type: 'varchar', length: 50, nullable: true })
  layoutCode: string | null;

  /** Diện tích thông thủy (m²), NUMERIC(8,2) → string. */
  @Column({ name: 'net_area', type: 'numeric', precision: 8, scale: 2 })
  netArea: string;

  @Column({ name: 'bedroom_count', type: 'smallint' })
  bedroomCount: number;

  @Column({ name: 'bathroom_count', type: 'smallint' })
  bathroomCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Room, (room) => room.apartment)
  rooms?: Relation<Room[]>;

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Không đổi `owner_id`. */
  update(patch: ApartmentPatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
  }
}

export type ApartmentPatch = Partial<
  Pick<
    Apartment,
    | 'buildingName'
    | 'address'
    | 'tower'
    | 'unitNo'
    | 'floorNo'
    | 'layoutCode'
    | 'netArea'
    | 'bedroomCount'
    | 'bathroomCount'
  >
>;
