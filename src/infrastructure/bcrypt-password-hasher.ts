import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../common/ports/password-hasher.js';

export const DEFAULT_BCRYPT_ROUNDS = 10;

/** Đăng ký bằng `useFactory` (không qua DI constructor) để test truyền được số rounds thấp. */
export class BcryptPasswordHasher implements PasswordHasher {
  private readonly rounds: number;

  constructor(rounds?: number) {
    this.rounds = rounds ?? DEFAULT_BCRYPT_ROUNDS;
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
