import { BusinessRuleError } from '../../../common/errors/index.js';
import { User } from '../entities/user.entity.js';
import type { UserStatus } from '../user-status.js';

const AT = new Date('2026-10-09T08:00:00.000Z');

function user(status: UserStatus): User {
  return Object.assign(new User(), { status, activatedAt: null });
}

describe('User.activate', () => {
  it('INVITED → ACTIVE, ghi activated_at', () => {
    const u = user('INVITED');

    u.activate(AT);

    expect(u.status).toBe('ACTIVE');
    expect(u.activatedAt).toEqual(AT);
  });

  it('ACTIVE → ACTIVE không hợp lệ → INVALID_USER_STATUS_TRANSITION, không đổi gì', () => {
    const u = user('ACTIVE');

    expect(() => u.activate(AT)).toThrow(BusinessRuleError);
    expect(u.activatedAt).toBeNull();
  });
});

describe('User.changePassword', () => {
  it('thay password_hash, không đổi trạng thái', () => {
    const u = Object.assign(user('ACTIVE'), { passwordHash: 'cu' });

    u.changePassword('moi');

    expect(u.passwordHash).toBe('moi');
    expect(u.status).toBe('ACTIVE');
  });
});
