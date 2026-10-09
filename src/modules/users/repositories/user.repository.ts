import type { DesignerProfile } from '../entities/designer-profile.entity.js';
import type { SupplierProfile } from '../entities/supplier-profile.entity.js';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { User } from '../entities/user.entity.js';
import type { UserStatus } from '../user-status.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export type NewUser = Pick<
  User,
  | 'roleId'
  | 'email'
  | 'passwordHash'
  | 'fullName'
  | 'phone'
  | 'status'
  | 'createdById'
>;

export type NewDesignerProfile = Pick<
  DesignerProfile,
  | 'userId'
  | 'employeeCode'
  | 'title'
  | 'specialization'
  | 'yearsOfExperience'
  | 'bio'
>;

export type NewSupplierProfile = Pick<
  SupplierProfile,
  | 'userId'
  | 'companyName'
  | 'taxCode'
  | 'businessAddress'
  | 'contactName'
  | 'contactPhone'
  | 'website'
  | 'partnershipStatus'
  | 'partnerSince'
>;

export interface UserSearchFilter {
  roleId?: number;
  status?: UserStatus;
  /** Tìm trong email hoặc họ tên, không phân biệt hoa thường. */
  keyword?: string;
}

export interface PageRequest {
  page: number;
  limit: number;
}

/** `users` + `designer_profiles`, `supplier_profiles` (ghi cùng user). Không có `delete`: không xóa cứng tài khoản. */
export interface UserRepository {
  findById(id: string): Promise<User | null>;

  /** `email` phải đã chuẩn hóa (trim + lowercase). */
  findByEmail(email: string): Promise<User | null>;

  /** Kèm `designerProfile`, `supplierProfile` (null nếu không có). */
  findByIdWithProfiles(id: string): Promise<User | null>;

  /** Thêm user; email đã tồn tại (kể cả do request đồng thời) → `null`. */
  createIfEmailAvailable(user: NewUser): Promise<User | null>;

  /** Thêm designer profile; `employee_code` đã tồn tại → `null`. */
  createDesignerProfileIfCodeAvailable(
    profile: NewDesignerProfile,
  ): Promise<DesignerProfile | null>;

  /** Thêm supplier profile; `tax_code` đã tồn tại → `null`. */
  createSupplierProfileIfTaxCodeAvailable(
    profile: NewSupplierProfile,
  ): Promise<SupplierProfile | null>;

  /** Đếm Admin ACTIVE và khóa các dòng đó (`FOR UPDATE`) đến hết transaction. Phải gọi trong `UnitOfWork.run`. */
  countActiveAdminsForUpdate(): Promise<number>;

  /** Mới tạo trước; không nạp profile. */
  search(filter: UserSearchFilter, page: PageRequest): Promise<Paginated<User>>;

  /** Lưu designer profile đã có; `employee_code` trùng user khác → `null`. */
  saveDesignerProfileIfCodeAvailable(
    profile: DesignerProfile,
  ): Promise<DesignerProfile | null>;

  /** Lưu supplier profile đã có; `tax_code` trùng user khác → `null`. */
  saveSupplierProfileIfTaxCodeAvailable(
    profile: SupplierProfile,
  ): Promise<SupplierProfile | null>;

  save(user: User): Promise<User>;
}
