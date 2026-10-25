import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Apartment } from './apartment.entity.js';

export const ROOM_TYPES = [
  'LIVING_ROOM',
  'BEDROOM',
  'KITCHEN',
  'DINING_ROOM',
  'BATHROOM',
  'WORKING_ROOM',
  'BALCONY',
  'OTHER',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** Phòng trong căn hộ. Chỉ thêm, chưa có sửa/xóa. */
@Entity({ name: 'rooms' })
@Index('idx_rooms_apartment_id', ['apartmentId'])
@Check('chk_rooms_room_type', sqlIn('room_type', ROOM_TYPES))
@Check('chk_rooms_area', '"area" > 0')
export class Room {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_rooms' })
  id: string;

  @Column({ name: 'apartment_id', type: 'uuid' })
  apartmentId: string;

  @ManyToOne(() => Apartment, (apartment) => apartment.rooms, {
    nullable: false,
  })
  @JoinColumn({
    name: 'apartment_id',
    foreignKeyConstraintName: 'fk_rooms_apartment_id',
  })
  apartment?: Relation<Apartment>;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'room_type', type: 'varchar', length: 20 })
  roomType: RoomType;

  /** m², NUMERIC(8,2) → string. */
  @Column({
    name: 'area',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  area: string | null;

  @Column({ name: 'purpose', type: 'varchar', length: 255, nullable: true })
  purpose: string | null;
}
