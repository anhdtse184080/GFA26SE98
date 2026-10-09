import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser, JwtPayload } from '../../common/auth/auth-user.js';
import { JWT_STRATEGY } from '../../common/auth/jwt-auth.guard.js';
import { AuthService } from './auth.service.js';

export const JWT_SECRET = Symbol('JWT_SECRET');

/** Bearer token → kiểm tra chữ ký/hạn (passport-jwt) → kiểm tra lại user trong DB (AuthService). */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(
    private readonly auth: AuthService,
    @Inject(JWT_SECRET) secret: string,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtPayload): Promise<AuthUser> {
    return this.auth.authenticate(payload);
  }
}
