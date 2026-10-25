import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import { ApartmentsService } from './apartments.service.js';
import {
  CreateApartmentDto,
  CreateRoomDto,
  ListApartmentsQueryDto,
  UpdateApartmentDto,
} from './dto/apartments.dto.js';
import {
  ApartmentPageResponseDto,
  ApartmentResponseDto,
  RoomResponseDto,
} from './dto/apartments.response.dto.js';

/**
 * `/apartments` (Customer: căn của mình; Staff/Admin: mọi căn, tạo hộ customer bằng `ownerEmail`),
 * `/apartments/:id/rooms`. Không có DELETE, không sửa phòng.
 */
@ApiTags('apartments')
@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly apartments: ApartmentsService) {}

  /** Danh sách căn hộ (Customer chỉ thấy căn của mình), lọc theo từ khóa và chủ căn; có phân trang. */
  @Roles('CUSTOMER', 'STAFF', 'ADMIN')
  @Get()
  async list(
    @Query() query: ListApartmentsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ApartmentPageResponseDto> {
    const page = await this.apartments.list(actor, {
      page: query.page,
      limit: query.limit,
      ownerId: query.ownerId,
      keyword: query.q,
    });
    return ApartmentPageResponseDto.from(page);
  }

  /**
   * Customer tạo căn của mình (không gửi `ownerEmail`). Staff/Admin bắt buộc gửi `ownerEmail`:
   * email chưa đăng ký → 404 USER_NOT_FOUND, chưa ACTIVE → 422 USER_NOT_ACTIVE.
   * Chủ căn đã có căn trùng (tên chung cư, tòa, mã căn) → 409 APARTMENT_ALREADY_EXISTS.
   */
  @Roles('CUSTOMER', 'STAFF', 'ADMIN')
  @Post()
  async create(
    @Body() dto: CreateApartmentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ApartmentResponseDto> {
    const apartment = await this.apartments.create(actor, {
      ownerEmail: dto.ownerEmail,
      buildingName: dto.buildingName,
      address: dto.address,
      tower: dto.tower ?? null,
      unitNo: dto.unitNo,
      floorNo: dto.floorNo ?? null,
      layoutCode: dto.layoutCode ?? null,
      netArea: String(dto.netArea),
      bedroomCount: dto.bedroomCount,
      bathroomCount: dto.bathroomCount,
    });
    return ApartmentResponseDto.from(apartment);
  }

  /** Chi tiết căn hộ (căn của người khác với Customer → 404). */
  @Roles('CUSTOMER', 'STAFF', 'ADMIN')
  @Get(':id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ApartmentResponseDto> {
    return ApartmentResponseDto.from(await this.apartments.get(id, actor));
  }

  /**
   * Sửa thông tin căn hộ; không đổi chủ căn. Staff chỉ sửa căn có dự án mình phụ trách (403 NOT_APARTMENT_STAFF);
   * căn có dự án đã qua DRAFT, chưa kết thúc → 422 APARTMENT_LOCKED; sửa thành trùng căn khác → 409 APARTMENT_ALREADY_EXISTS.
   */
  @Roles('CUSTOMER', 'STAFF', 'ADMIN')
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateApartmentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ApartmentResponseDto> {
    const apartment = await this.apartments.update(id, actor, {
      buildingName: dto.buildingName,
      address: dto.address,
      tower: dto.tower,
      unitNo: dto.unitNo,
      floorNo: dto.floorNo,
      layoutCode: dto.layoutCode,
      netArea: dto.netArea === undefined ? undefined : String(dto.netArea),
      bedroomCount: dto.bedroomCount,
      bathroomCount: dto.bathroomCount,
    });
    return ApartmentResponseDto.from(apartment);
  }

  @Roles('CUSTOMER', 'STAFF', 'ADMIN')
  @Get(':id/rooms')
  async listRooms(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoomResponseDto[]> {
    const rooms = await this.apartments.listRooms(id, actor);
    return rooms.map((r) => RoomResponseDto.from(r));
  }

  /** Thêm phòng; cùng điều kiện quyền và khóa như sửa căn hộ. */
  @Roles('CUSTOMER', 'STAFF', 'ADMIN')
  @Post(':id/rooms')
  async addRoom(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateRoomDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoomResponseDto> {
    const room = await this.apartments.addRoom(id, actor, {
      name: dto.name,
      roomType: dto.roomType,
      area: dto.area === undefined ? null : String(dto.area),
      purpose: dto.purpose ?? null,
    });
    return RoomResponseDto.from(room);
  }
}
