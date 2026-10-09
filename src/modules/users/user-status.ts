export const USER_STATUSES = [
  'INVITED',
  'ACTIVE',
  'INACTIVE',
  'LOCKED',
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Chuyển trạng thái hợp lệ (DB_CONTEXT §6.1):
 * INVITED → ACTIVE chỉ khi xác thực OTP; Admin khóa/mở khóa/vô hiệu hóa tài khoản đã kích hoạt. Không xóa cứng.
 */
export const USER_STATUS_TRANSITIONS: Readonly<
  Record<UserStatus, readonly UserStatus[]>
> = {
  INVITED: ['ACTIVE'],
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

export const USER_STATUS_ACTIONS = [
  'LOCK',
  'UNLOCK',
  'DEACTIVATE',
  'REACTIVATE',
] as const;

export type UserStatusAction = (typeof USER_STATUS_ACTIONS)[number];

/**
 * Hành động Admin đổi trạng thái: trạng thái nguồn được phép → trạng thái đích.
 * User INVITED không có hành động nào (mở khóa không được bỏ qua bước xác thực email).
 */
export const USER_STATUS_ACTION_RULES: Readonly<
  Record<UserStatusAction, { from: readonly UserStatus[]; to: UserStatus }>
> = {
  LOCK: { from: ['ACTIVE', 'INACTIVE'], to: 'LOCKED' },
  UNLOCK: { from: ['LOCKED'], to: 'ACTIVE' },
  DEACTIVATE: { from: ['ACTIVE', 'LOCKED'], to: 'INACTIVE' },
  REACTIVATE: { from: ['INACTIVE'], to: 'ACTIVE' },
};
