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

/** Số tiền ≥ 0, tối đa 13 chữ số phần nguyên và 2 chữ số thập phân (NUMERIC(15,2)). */
export const MONEY_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;
/** Như `MONEY_PATTERN` nhưng > 0. */
export const POSITIVE_MONEY_PATTERN =
  /^(?!0+(\.0{1,2})?$)\d{1,13}(\.\d{1,2})?$/;

/** Tiền nhận string (khuyến nghị, giữ chính xác) hoặc number; regex kiểm tra sau. */
export const toMoneyString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : trim({ value });
