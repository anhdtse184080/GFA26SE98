export const ROLE_CODES = [
  'ADMIN',
  'STAFF',
  'DESIGNER',
  'CUSTOMER',
  'SUPPLIER',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/** `roles.id` cố định (SMALLINT), seed và code dùng chung. */
export const ROLE_IDS: Readonly<Record<RoleCode, number>> = {
  ADMIN: 1,
  STAFF: 2,
  DESIGNER: 3,
  CUSTOMER: 4,
  SUPPLIER: 5,
};

const ROLE_CODE_BY_ID: ReadonlyMap<number, RoleCode> = new Map(
  (Object.keys(ROLE_IDS) as RoleCode[]).map((code) => [ROLE_IDS[code], code]),
);

/** `roles.id` → code. id không thuộc 5 role đã seed là lỗi dữ liệu → ném. */
export function roleCodeOf(roleId: number): RoleCode {
  const code = ROLE_CODE_BY_ID.get(roleId);
  if (!code) {
    throw new Error(`Unknown role_id ${roleId}`);
  }
  return code;
}
