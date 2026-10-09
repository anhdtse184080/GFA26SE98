import {
  ForbiddenError,
  UnauthorizedError,
} from '../../../common/errors/index.js';
import { AuthPolicy } from '../auth.policy.js';

describe('AuthPolicy', () => {
  it('ACTIVE được đăng nhập và dùng token', () => {
    expect(() => AuthPolicy.assertCanLogin('ACTIVE')).not.toThrow();
    expect(() => AuthPolicy.assertCanUseToken('ACTIVE')).not.toThrow();
  });

  it.each([
    ['INVITED', 'EMAIL_NOT_VERIFIED'],
    ['LOCKED', 'ACCOUNT_LOCKED'],
    ['INACTIVE', 'ACCOUNT_INACTIVE'],
  ] as const)('%s → %s: đăng nhập 403, dùng token 401', (status, code) => {
    expect(() => AuthPolicy.assertCanLogin(status)).toThrow(
      expect.objectContaining({ code, constructor: ForbiddenError }) as Error,
    );
    expect(() => AuthPolicy.assertCanUseToken(status)).toThrow(
      expect.objectContaining({
        code,
        constructor: UnauthorizedError,
      }) as Error,
    );
  });
});
