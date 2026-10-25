import { Injectable } from '@nestjs/common';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { escapeLike } from '../../database/postgres/escape-like.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { Apartment } from './entities/apartment.entity.js';
import { Room } from './entities/room.entity.js';

export type NewApartment = Pick<
  Apartment,
  | 'ownerId'
  | 'buildingName'
  | 'address'
  | 'tower'
  | 'unitNo'
  | 'floorNo'
  | 'layoutCode'
  | 'netArea'
  | 'bedroomCount'
  | 'bathroomCount'
>;

export type NewRoom = Pick<
  Room,
  'apartmentId' | 'name' | 'roomType' | 'area' | 'purpose'
>;

/** Dự án trên một căn hộ (chỉ các cột cần để quyết định quyền sửa căn). */
export interface ApartmentProjectRef {
  id: string;
  staffId: string;
  status: string;
}

export interface ApartmentSearchFilter {
  ownerId?: string;
  /** Tìm trong tên chung cư, địa chỉ, mã căn (không phân biệt hoa thường). */
  keyword?: string;
}

/** `apartments` + `rooms`. Không có `delete`. */
@Injectable()
export class ApartmentsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(Apartment);
  }

  private get roomRepo() {
    return this.tx.manager.getRepository(Room);
  }

  findById(id: string): Promise<Apartment | null> {
    return this.repo.findOne({ where: { id }, relations: { owner: true } });
  }

  /**
   * Căn khác của cùng chủ có cùng tên chung cư, tòa, mã căn (không phân biệt hoa thường; tòa `null` = rỗng).
   * `excludeId`: bỏ qua chính căn đang sửa.
   */
  findSameUnit(
    ownerId: string,
    unit: Pick<Apartment, 'buildingName' | 'tower' | 'unitNo'>,
    excludeId?: string,
  ): Promise<Apartment | null> {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.ownerId = :ownerId', { ownerId })
      .andWhere('LOWER(a.buildingName) = LOWER(:buildingName)', {
        buildingName: unit.buildingName,
      })
      .andWhere("LOWER(COALESCE(a.tower, '')) = LOWER(:tower)", {
        tower: unit.tower ?? '',
      })
      .andWhere('LOWER(a.unitNo) = LOWER(:unitNo)', { unitNo: unit.unitNo });
    if (excludeId !== undefined) {
      qb.andWhere('a.id <> :excludeId', { excludeId });
    }
    return qb.getOne();
  }

  async search(
    filter: ApartmentSearchFilter,
    page: PageRequest,
  ): Promise<Paginated<Apartment>> {
    const qb = this.repo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.owner', 'o');
    if (filter.ownerId !== undefined) {
      qb.andWhere('a.ownerId = :ownerId', { ownerId: filter.ownerId });
    }
    if (filter.keyword) {
      qb.andWhere(
        '(a.buildingName ILIKE :keyword OR a.address ILIKE :keyword OR a.unitNo ILIKE :keyword)',
        { keyword: `%${escapeLike(filter.keyword)}%` },
      );
    }
    const [items, total] = await qb
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'ASC')
      .skip((page.page - 1) * page.limit)
      .take(page.limit)
      .getManyAndCount();
    return { items, page: page.page, limit: page.limit, total };
  }

  create(apartment: NewApartment): Promise<Apartment> {
    return this.repo.save(this.repo.create(apartment));
  }

  save(apartment: Apartment): Promise<Apartment> {
    return this.repo.save(apartment);
  }

  /**
   * Các dự án trên căn hộ. Đọc bảng `projects` theo tên bảng (không import entity `Project`)
   * vì module projects phụ thuộc apartments, không được phụ thuộc ngược.
   */
  findProjectRefs(apartmentId: string): Promise<ApartmentProjectRef[]> {
    return this.tx.manager
      .createQueryBuilder()
      .select('p.id', 'id')
      .addSelect('p.staff_id', 'staffId')
      .addSelect('p.status', 'status')
      .from('projects', 'p')
      .where('p.apartment_id = :apartmentId', { apartmentId })
      .getRawMany<ApartmentProjectRef>();
  }

  findRooms(apartmentId: string): Promise<Room[]> {
    return this.roomRepo.find({
      where: { apartmentId },
      order: { name: 'ASC', id: 'ASC' },
    });
  }

  /** Đọc lại sau khi lưu để `area` có đúng định dạng NUMERIC(8,2). */
  async createRoom(room: NewRoom): Promise<Room> {
    const saved = await this.roomRepo.save(this.roomRepo.create(room));
    return this.roomRepo.findOneByOrFail({ id: saved.id });
  }
}
