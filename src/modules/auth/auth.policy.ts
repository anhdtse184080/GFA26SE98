import {
  type DomainError,
  ForbiddenError,
  UnauthorizedError,
} from '../../common/errors/index.js';
import type { UserStatus } from '../users/user-status.js';

type BlockedStatus = Exclude<UserStatus, 'ACTIVE'>;

const BLOCKED: Readonly<
  Record<BlockedStatus, [code: string, message: string]>
> = {
  INVITED: [
    'EMAIL_NOT_VERIFIED',
    'Email chưa được xác thực, vui lòng nhập mã OTP đã gửi qua email (hoặc gọi /auth/resend-otp)',
  ],
  LOCKED: ['ACCOUNT_LOCKED', 'Tài khoản đã bị khóa'],
  INACTIVE: ['ACCOUNT_INACTIVE', 'Tài khoản đã bị vô hiệu hóa'],
};

/** Quy tắc đăng nhập thuần (không I/O): chỉ user ACTIVE được đăng nhập / dùng token. */
export const AuthPolicy = {
  /** Đăng nhập đúng mật khẩu nhưng trạng thái không cho phép → 403. */
  assertCanLogin(status: UserStatus): void {
    const error = blockedError(status, ForbiddenError);
    if (error) throw error;
  },

  /** Token hợp lệ nhưng user không còn ACTIVE (bị khóa sau khi đăng nhập…) → 401. */
  assertCanUseToken(status: UserStatus): void {
    const error = blockedError(status, UnauthorizedError);
    if (error) throw error;
  },
};

function blockedError(
  status: UserStatus,
  ErrorClass: new (code: string, message: string) => DomainError,
): DomainError | null {
  if (status === 'ACTIVE') return null;
  const [code, message] = BLOCKED[status];
  return new ErrorClass(code, message);
}
