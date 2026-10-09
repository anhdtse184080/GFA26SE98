import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RoleCode } from '../../modules/users/role-code.enum.js';
import type { AuthUser } from './auth-user.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Bỏ qua JwtAuthGuard toàn cục (route công khai). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Chỉ cho các role này (RolesGuard). Không gắn = mọi user đã đăng nhập. */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);

/** User hiện tại do JwtAuthGuard gắn vào request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
