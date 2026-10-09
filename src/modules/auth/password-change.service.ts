import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  UnauthorizedError,
} from '../../common/errors/index.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../common/ports/password-hasher.js';
import { UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { LoginResult } from './auth.service.js';

/** User đã đăng nhập tự đổi mật khẩu. */
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: AccessTokenService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Đổi mật khẩu rồi phát access token mới: mọi token cũ (kể cả token đang dùng)
   * bị thu hồi vì `pwv` không còn khớp `password_hash`.
   *
   * @throws UnauthorizedError `INVALID_CURRENT_PASSWORD`
   * @throws BusinessRuleError `NEW_PASSWORD_SAME_AS_CURRENT`
   */
  async change(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<LoginResult> {
    const user = await this.users.findById(userId);
    const hash = user?.passwordHash;
    if (!user || !hash || !(await this.hasher.compare(currentPassword, hash))) {
      throw new UnauthorizedError(
        'INVALID_CURRENT_PASSWORD',
        'Mật khẩu hiện tại không đúng',
      );
    }
    if (await this.hasher.compare(newPassword, hash)) {
      throw new BusinessRuleError(
        'NEW_PASSWORD_SAME_AS_CURRENT',
        'Mật khẩu mới phải khác mật khẩu hiện tại',
      );
    }

    const updated = await this.users.changePassword(
      user,
      await this.hasher.hash(newPassword),
    );
    return { accessToken: await this.tokens.issue(updated), user: updated };
  }
}
