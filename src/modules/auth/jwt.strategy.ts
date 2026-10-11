import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser, JwtPayload } from '../../common/auth/auth-user.js';
import { JWT_STRATEGY } from '../../common/auth/jwt-auth.guard.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AuthService } from './auth.service.js';

/** Bearer token → kiểm tra chữ ký/hạn (passport-jwt) → kiểm tra lại user trong DB (AuthService). */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtPayload): Promise<AuthUser> {
    return this.auth.authenticate(payload);
  }
}
