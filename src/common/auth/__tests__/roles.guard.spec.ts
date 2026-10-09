import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError } from '../../errors/index.js';
import type { AuthUser } from '../auth-user.js';
import { Roles } from '../decorators.js';
import { RolesGuard } from '../roles.guard.js';

class Handlers {
  @Roles('ADMIN', 'STAFF')
  adminOrStaff() {}

  anyone() {}
}

function context(handler: keyof Handlers, user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const user = (role: AuthUser['role']): AuthUser => ({
  id: 'u1',
  email: 'a@b.c',
  role,
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('route không gắn @Roles → cho qua', () => {
    expect(guard.canActivate(context('anyone', user('CUSTOMER')))).toBe(true);
  });

  it('role nằm trong @Roles → cho qua', () => {
    expect(guard.canActivate(context('adminOrStaff', user('STAFF')))).toBe(
      true,
    );
  });

  it('role không nằm trong @Roles → INSUFFICIENT_ROLE (403)', () => {
    expect(() =>
      guard.canActivate(context('adminOrStaff', user('CUSTOMER'))),
    ).toThrow(ForbiddenError);
  });

  it('không có user → INSUFFICIENT_ROLE', () => {
    expect(() => guard.canActivate(context('adminOrStaff'))).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_ROLE' }) as Error,
    );
  });
});
