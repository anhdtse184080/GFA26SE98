import type { User } from '../entities/user.entity.js';

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

/** `users` (+ đọc kèm `designer_profiles`, `supplier_profiles`). Không có `delete`: không xóa cứng tài khoản. */
export interface UserRepository {
  findById(id: string): Promise<User | null>;

  /** `email` phải đã chuẩn hóa (trim + lowercase). */
  findByEmail(email: string): Promise<User | null>;

  /** Kèm `designerProfile`, `supplierProfile` (null nếu không có). */
  findByIdWithProfiles(id: string): Promise<User | null>;

  /** Thêm user; email đã tồn tại (kể cả do request đồng thời) → `null`. */
  createIfEmailAvailable(user: NewUser): Promise<User | null>;

  save(user: User): Promise<User>;
}
