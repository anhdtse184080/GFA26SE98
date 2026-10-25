import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RequestValidationError,
} from '../../common/errors/index.js';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { UsersService } from '../users/users.service.js';
import {
  type ApartmentSearchFilter,
  ApartmentsRepository,
  type NewApartment,
  type NewRoom,
} from './apartments.repository.js';
import type { Apartment, ApartmentPatch } from './entities/apartment.entity.js';
import type { Room } from './entities/room.entity.js';

export interface CreateApartmentInput extends Omit<NewApartment, 'ownerId'> {
  /** Đã chuẩn hóa (trim + lowercase). Bắt buộc với Staff/Admin, cấm với Customer. */
  ownerEmail?: string;
}

export type CreateRoomInput = Omit<NewRoom, 'apartmentId'>;

/**
 * Dự án ở các trạng thái này khóa căn hộ (không sửa thông tin, không thêm phòng): hợp đồng, thiết kế,
 * báo giá đã dựa trên dữ liệu căn. DRAFT còn sửa được; COMPLETED/CANCELLED đã kết thúc.
 */
const LOCKING_PROJECT_STATUSES: readonly string[] = [
  'CONTRACT_PENDING',
  'REQUIREMENT_ANALYSIS',
  'IN_DESIGN',
  'PRODUCT_SELECTION',
  'QUOTING',
];

export interface ListApartmentsInput extends PageRequest {
  /** Chỉ có tác dụng với Staff/Admin; Customer luôn bị giới hạn vào căn của mình. */
  ownerId?: string;
  keyword?: string;
}

/**
 * Căn hộ chung cư và phòng (DB_CONTEXT §4.2). Customer tạo/xem/sửa căn của mình;
 * Staff/Admin xem/sửa mọi căn và tạo hộ customer theo email. Không xóa, không đổi chủ căn.
 * Module `projects` dùng `getApartmentOrThrow`, `getWithRooms`.
 */
@Injectable()
export class ApartmentsService {
  constructor(
    private readonly apartments: ApartmentsRepository,
    private readonly users: UsersService,
  ) {}

  // ---------- Căn hộ ----------

  list(
    actor: AuthUser,
    input: ListApartmentsInput,
  ): Promise<Paginated<Apartment>> {
    const filter: ApartmentSearchFilter = {
      ownerId: actor.role === 'CUSTOMER' ? actor.id : input.ownerId,
      keyword: input.keyword || undefined,
    };
    return this.apartments.search(filter, {
      page: input.page,
      limit: input.limit,
    });
  }

  /** @throws NotFoundError `APARTMENT_NOT_FOUND` (cả khi customer xem căn của người khác) */
  async get(id: string, actor: AuthUser): Promise<Apartment> {
    const apartment = await this.getApartmentOrThrow(id);
    this.assertCanAccess(apartment, actor);
    return apartment;
  }

  /**
   * @throws RequestValidationError `ownerEmail` (Customer gửi ownerEmail, Staff/Admin thiếu ownerEmail)
   * @throws NotFoundError `USER_NOT_FOUND`
   * @throws BusinessRuleError `USER_NOT_ACTIVE`
   * @throws ConflictError `APARTMENT_ALREADY_EXISTS`
   */
  async create(
    actor: AuthUser,
    input: CreateApartmentInput,
  ): Promise<Apartment> {
    const { ownerEmail, ...fields } = input;
    const ownerId = await this.resolveOwnerId(actor, ownerEmail);
    await this.assertNotDuplicate(ownerId, fields);
    const apartment = await this.apartments.create({ ...fields, ownerId });
    return this.getApartmentOrThrow(apartment.id);
  }

  /**
   * Không đổi chủ căn.
   * @throws NotFoundError `APARTMENT_NOT_FOUND`
   * @throws ForbiddenError `NOT_APARTMENT_STAFF`
   * @throws BusinessRuleError `APARTMENT_LOCKED`
   * @throws ConflictError `APARTMENT_ALREADY_EXISTS`
   */
  async update(
    id: string,
    actor: AuthUser,
    patch: ApartmentPatch,
  ): Promise<Apartment> {
    const apartment = await this.getEditableApartment(id, actor);
    apartment.update(patch);
    await this.assertNotDuplicate(apartment.ownerId, apartment, apartment.id);
    await this.apartments.save(apartment);
    return this.getApartmentOrThrow(id);
  }

  // ---------- Phòng ----------

  /** @throws NotFoundError `APARTMENT_NOT_FOUND` */
  async listRooms(apartmentId: string, actor: AuthUser): Promise<Room[]> {
    await this.get(apartmentId, actor);
    return this.apartments.findRooms(apartmentId);
  }

  /**
   * @throws NotFoundError `APARTMENT_NOT_FOUND`
   * @throws ForbiddenError `NOT_APARTMENT_STAFF`
   * @throws BusinessRuleError `APARTMENT_LOCKED`
   */
  async addRoom(
    apartmentId: string,
    actor: AuthUser,
    input: CreateRoomInput,
  ): Promise<Room> {
    await this.getEditableApartment(apartmentId, actor);
    return this.apartments.createRoom({ ...input, apartmentId });
  }

  // ---------- Dùng chung với module projects ----------

  /**
   * Căn hộ không kiểm tra quyền xem; caller tự phân quyền.
   * @throws NotFoundError `APARTMENT_NOT_FOUND`
   */
  async getApartmentOrThrow(id: string): Promise<Apartment> {
    const apartment = await this.apartments.findById(id);
    if (!apartment) {
      throw new NotFoundError('APARTMENT_NOT_FOUND', 'Không tìm thấy căn hộ', {
        apartmentId: id,
      });
    }
    return apartment;
  }

  /** Căn hộ kèm danh sách phòng, không kiểm tra quyền xem. @throws NotFoundError `APARTMENT_NOT_FOUND` */
  async getWithRooms(id: string): Promise<Apartment> {
    const apartment = await this.getApartmentOrThrow(id);
    apartment.rooms = await this.apartments.findRooms(id);
    return apartment;
  }

  // ---------- Private ----------

  /** Customer chỉ truy cập căn của mình (căn người khác → 404); Staff/Admin truy cập mọi căn. */
  private assertCanAccess(apartment: Apartment, actor: AuthUser): void {
    if (actor.role === 'ADMIN' || actor.role === 'STAFF') return;
    if (actor.role === 'CUSTOMER' && apartment.ownerId === actor.id) return;
    if (actor.role === 'CUSTOMER') {
      throw new NotFoundError('APARTMENT_NOT_FOUND', 'Không tìm thấy căn hộ', {
        apartmentId: apartment.id,
      });
    }
    throw new ForbiddenError('FORBIDDEN', 'Không đủ quyền truy cập căn hộ');
  }

  /**
   * Quyền sửa căn hộ / thêm phòng: Customer căn của mình, Admin mọi căn, Staff chỉ căn có dự án mình phụ trách.
   * Căn đang có dự án ở trạng thái khóa (LOCKING_PROJECT_STATUSES) thì không ai sửa được.
   */
  private async getEditableApartment(
    id: string,
    actor: AuthUser,
  ): Promise<Apartment> {
    const apartment = await this.get(id, actor);
    const projects = await this.apartments.findProjectRefs(id);
    if (
      actor.role === 'STAFF' &&
      !projects.some((p) => p.staffId === actor.id)
    ) {
      throw new ForbiddenError(
        'NOT_APARTMENT_STAFF',
        'Staff chỉ sửa được căn hộ có dự án mình phụ trách',
        { apartmentId: id },
      );
    }
    const locking = projects.find((p) =>
      LOCKING_PROJECT_STATUSES.includes(p.status),
    );
    if (locking) {
      throw new BusinessRuleError(
        'APARTMENT_LOCKED',
        'Căn hộ đang có dự án đã vào giai đoạn hợp đồng/thiết kế, không sửa được',
        { projectId: locking.id, projectStatus: locking.status },
      );
    }
    return apartment;
  }

  /**
   * Một chủ căn không có hai căn trùng (tên chung cư, tòa, mã căn), không phân biệt hoa thường.
   * Chỉ kiểm tra ở ứng dụng (DB_CONTEXT không có UQ).
   * @throws ConflictError `APARTMENT_ALREADY_EXISTS`
   */
  private async assertNotDuplicate(
    ownerId: string,
    unit: Pick<Apartment, 'buildingName' | 'tower' | 'unitNo'>,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.apartments.findSameUnit(
      ownerId,
      unit,
      excludeId,
    );
    if (existing) {
      throw new ConflictError(
        'APARTMENT_ALREADY_EXISTS',
        'Chủ căn đã có căn hộ trùng tên chung cư, tòa và mã căn',
        { apartmentId: existing.id },
      );
    }
  }

  private async resolveOwnerId(
    actor: AuthUser,
    ownerEmail: string | undefined,
  ): Promise<string> {
    if (actor.role === 'CUSTOMER') {
      if (ownerEmail != null) {
        throw new RequestValidationError([
          {
            field: 'ownerEmail',
            errors: [
              'Customer chỉ tạo căn hộ cho chính mình, không gửi ownerEmail',
            ],
          },
        ]);
      }
      return actor.id;
    }
    if (actor.role !== 'ADMIN' && actor.role !== 'STAFF') {
      throw new ForbiddenError('FORBIDDEN', 'Không đủ quyền tạo căn hộ');
    }
    if (ownerEmail == null) {
      throw new RequestValidationError([
        {
          field: 'ownerEmail',
          errors: [
            'ownerEmail là bắt buộc khi Staff/Admin tạo căn hộ hộ customer',
          ],
        },
      ]);
    }
    return (await this.users.findInvitableCustomerByEmail(ownerEmail)).id;
  }
}
