import { randomUUID } from 'node:crypto';
import type { DesignerProfile } from '../entities/designer-profile.entity.js';
import type { SupplierProfile } from '../entities/supplier-profile.entity.js';
import { User } from '../entities/user.entity.js';
import type {
  NewUser,
  UserRepository,
} from '../repositories/user.repository.js';

/** Fake cho unit test: hành xử như TypeOrmUserRepository, trả bản sao để test không sửa trực tiếp "DB". */
export class InMemoryUserRepository implements UserRepository {
  readonly rows: User[] = [];
  readonly designerProfiles = new Map<string, DesignerProfile>();
  readonly supplierProfiles = new Map<string, SupplierProfile>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Thêm user trực tiếp (setup test), bỏ qua kiểm tra email. */
  seed(fields: Partial<User> & NewUser): User {
    const at = this.now();
    const row = Object.assign(new User(), {
      id: randomUUID(),
      avatarUrl: null,
      activatedAt: null,
      lastLoginAt: null,
      createdAt: at,
      updatedAt: at,
      ...fields,
    });
    this.rows.push(row);
    return copy(row);
  }

  findById(id: string) {
    return Promise.resolve(this.find((r) => r.id === id));
  }

  findByEmail(email: string) {
    return Promise.resolve(this.find((r) => r.email === email));
  }

  findByIdWithProfiles(id: string) {
    const user = this.find((r) => r.id === id);
    if (user) {
      user.designerProfile = this.designerProfiles.get(id) ?? null;
      user.supplierProfile = this.supplierProfiles.get(id) ?? null;
    }
    return Promise.resolve(user);
  }

  createIfEmailAvailable(user: NewUser): Promise<User | null> {
    if (this.rows.some((r) => r.email === user.email)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.seed(user));
  }

  save(user: User): Promise<User> {
    const index = this.rows.findIndex((r) => r.id === user.id);
    const { designerProfile: _d, supplierProfile: _s, ...columns } = user;
    const row = Object.assign(new User(), columns, { updatedAt: this.now() });
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    return Promise.resolve(copy(row));
  }

  private find(match: (r: User) => boolean): User | null {
    const found = this.rows.find(match);
    return found ? copy(found) : null;
  }
}

function copy(row: User): User {
  return Object.assign(new User(), row);
}
