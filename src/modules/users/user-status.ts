export const USER_STATUSES = [
  'INVITED',
  'ACTIVE',
  'INACTIVE',
  'LOCKED',
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Chuyển trạng thái hợp lệ (DB_CONTEXT §6.1):
 * INVITED → ACTIVE khi xác thực OTP; Admin khóa/mở khóa/vô hiệu hóa. Không xóa cứng.
 */
export const USER_STATUS_TRANSITIONS: Readonly<
  Record<UserStatus, readonly UserStatus[]>
> = {
  INVITED: ['ACTIVE', 'LOCKED', 'INACTIVE'],
  ACTIVE: ['LOCKED', 'INACTIVE'],
  LOCKED: ['ACTIVE', 'INACTIVE'],
  INACTIVE: ['ACTIVE', 'LOCKED'],
};

export function canTransitionUserStatus(
  from: UserStatus,
  to: UserStatus,
): boolean {
  return USER_STATUS_TRANSITIONS[from].includes(to);
}
