/**
 * Lỗi nghiệp vụ do service ném ra. Không chứa thông tin HTTP;
 * `DomainExceptionFilter` quyết định status code.
 */
export abstract class DomainError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message ?? code);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {}

export class ConflictError extends DomainError {}

export class ForbiddenError extends DomainError {}

export class UnauthorizedError extends DomainError {}

export class BusinessRuleError extends DomainError {}

/** Vượt giới hạn tần suất (gửi lại OTP quá sớm, nhập sai quá số lần). */
export class TooManyRequestsError extends DomainError {}

export interface FieldError {
  field: string;
  errors: string[];
}

/** Dữ liệu request không hợp lệ (ValidationPipe). */
export class RequestValidationError extends DomainError {
  constructor(fields: FieldError[]) {
    super('VALIDATION_ERROR', 'Dữ liệu không hợp lệ', { fields });
  }
}
