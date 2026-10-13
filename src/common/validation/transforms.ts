/** Transform dùng chung cho request DTO (`@Transform(trim)`…). */

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trimUpperCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Số điện thoại: 9–15 chữ số, có thể bắt đầu bằng `+`. */
export const PHONE_PATTERN = /^\+?\d{9,15}$/;

/** Query string 'true'/'false' → boolean; giá trị khác giữ nguyên để @IsBoolean báo 400. */
export const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Mã danh mục (`design_styles.code`, `product_categories.code`): chữ in hoa, số, gạch dưới. */
export const CODE_PATTERN = /^[A-Z0-9_]+$/;
export const CODE_MESSAGE = 'code chỉ gồm chữ in hoa, số và dấu gạch dưới';
