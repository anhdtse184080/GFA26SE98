import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../common/auth/auth-user.js';
import type { User } from '../users/entities/user.entity.js';
import { roleCodeOf } from '../users/role-code.enum.js';
import {
  PASSWORD_FINGERPRINT_KEY,
  passwordFingerprint,
} from './password-fingerprint.js';

/** Phát access token; claim `pwv` gắn token với `password_hash` hiện tại. */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(PASSWORD_FINGERPRINT_KEY) private readonly fingerprintKey: Buffer,
  ) {}

  /** `user` phải đã có mật khẩu; chưa có là lỗi lập trình (nơi gọi đã xác thực mật khẩu). */
  issue(user: User): Promise<string> {
    if (user.passwordHash === null) {
      throw new Error(`User ${user.id} chưa có mật khẩu, không phát token`);
    }
    const payload: JwtPayload = {
      sub: user.id,
      role: roleCodeOf(user.roleId),
      pwv: passwordFingerprint(this.fingerprintKey, user.passwordHash),
    };
    return this.jwt.signAsync(payload);
  }
}
