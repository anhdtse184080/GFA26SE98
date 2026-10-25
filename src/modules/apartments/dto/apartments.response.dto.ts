import type { Paginated } from '../../../common/pagination/paginated.js';
import type { Apartment } from '../entities/apartment.entity.js';
import type { Room, RoomType } from '../entities/room.entity.js';

export class ApartmentOwnerDto {
  id: string;
  fullName: string;
  email: string;
}

export class RoomResponseDto {
  id: string;
  name: string;
  roomType: RoomType;
  /** m², dạng string 2 chữ số thập phân; null = chưa nhập */
  area: string | null;
  purpose: string | null;

  static from(room: Room): RoomResponseDto {
    return Object.assign(new RoomResponseDto(), {
      id: room.id,
      name: room.name,
      roomType: room.roomType,
      area: room.area,
      purpose: room.purpose,
    });
  }
}

export class ApartmentResponseDto {
  id: string;
  buildingName: string;
  address: string;
  tower: string | null;
  unitNo: string;
  floorNo: number | null;
  layoutCode: string | null;
  /** m², dạng string 2 chữ số thập phân (vd "65.50") */
  netArea: string;
  bedroomCount: number;
  bathroomCount: number;
  owner: ApartmentOwnerDto;
  createdAt: Date;
  updatedAt: Date;

  /** `apartment` phải được tải kèm `owner`. */
  static from(apartment: Apartment): ApartmentResponseDto {
    const owner = apartment.owner;
    if (!owner) throw new Error('Apartment must be loaded with owner');
    return Object.assign(new ApartmentResponseDto(), {
      id: apartment.id,
      buildingName: apartment.buildingName,
      address: apartment.address,
      tower: apartment.tower,
      unitNo: apartment.unitNo,
      floorNo: apartment.floorNo,
      layoutCode: apartment.layoutCode,
      netArea: apartment.netArea,
      bedroomCount: apartment.bedroomCount,
      bathroomCount: apartment.bathroomCount,
      owner: {
        id: owner.id,
        fullName: owner.fullName,
        email: owner.email,
      },
      createdAt: apartment.createdAt,
      updatedAt: apartment.updatedAt,
    });
  }
}

/** Căn hộ kèm phòng (nhúng trong chi tiết dự án). */
export class ApartmentWithRoomsResponseDto extends ApartmentResponseDto {
  rooms: RoomResponseDto[];

  /** `apartment` phải được tải kèm `owner` và `rooms`. */
  static override from(apartment: Apartment): ApartmentWithRoomsResponseDto {
    if (!apartment.rooms)
      throw new Error('Apartment must be loaded with rooms');
    return Object.assign(
      new ApartmentWithRoomsResponseDto(),
      ApartmentResponseDto.from(apartment),
      { rooms: apartment.rooms.map((r) => RoomResponseDto.from(r)) },
    );
  }
}

export class ApartmentPageResponseDto {
  items: ApartmentResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(page: Paginated<Apartment>): ApartmentPageResponseDto {
    return Object.assign(new ApartmentPageResponseDto(), {
      items: page.items.map((a) => ApartmentResponseDto.from(a)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
