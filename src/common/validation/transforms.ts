/** Transform dùng chung cho request DTO (`@Transform(trim)`…). */

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trimUpperCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Số điện thoại: 9–15 chữ số, có thể bắt đầu bằng `+`. */
export const PHONE_PATTERN = /^\+?\d{9,15}$/;
