import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UnauthorizedError } from '../errors/index.js';
import { IS_PUBLIC_KEY } from './decorators.js';

export const JWT_STRATEGY = 'jwt';

/**
 * Guard toàn cục: mọi route cần access token, trừ route gắn `@Public()`.
 * Strategy (modules/auth) kiểm tra lại user trong DB, nên token của user đã bị khóa cũng bị từ chối.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /** `err`: lỗi từ strategy (giữ nguyên lỗi domain); `info`: lỗi của passport-jwt (thiếu, sai, hết hạn). */
  override handleRequest<TUser>(
    err: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (err) throw err;
    if (!user) throw tokenError(info);
    return user;
  }
}

function tokenError(info: unknown): UnauthorizedError {
  const name = info instanceof Error ? info.name : undefined;
  if (name === 'TokenExpiredError') {
    return new UnauthorizedError('TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn');
  }
  if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
    return new UnauthorizedError('INVALID_TOKEN', 'Access token không hợp lệ');
  }
  return new UnauthorizedError('UNAUTHENTICATED', 'Vui lòng đăng nhập');
}
