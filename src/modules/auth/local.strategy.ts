import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import type { User } from '../users/entities/user.entity.js';
import { AuthService } from './auth.service.js';

export const LOCAL_STRATEGY = 'local';

/** Email + mật khẩu → kiểm tra trong DB (AuthService). Body đã được LocalAuthGuard validate. */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, LOCAL_STRATEGY) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  validate(email: string, password: string): Promise<User> {
    return this.auth.validateCredentials(email, password);
  }
}
