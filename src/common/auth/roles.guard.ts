import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RoleCode } from './role-code.js';
import { ForbiddenError } from '../errors/index.js';
import type { AuthUser } from './auth-user.js';
import { ROLES_KEY } from './decorators.js';

/** Chạy sau JwtAuthGuard. Route không gắn `@Roles()` thì cho mọi user đã đăng nhập. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenError(
        'INSUFFICIENT_ROLE',
        'Bạn không có quyền thực hiện thao tác này',
        { requiredRoles: roles },
      );
    }
    return true;
  }
}
