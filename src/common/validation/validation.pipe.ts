import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { type FieldError, RequestValidationError } from '../errors/index.js';

/** ValidationPipe toàn cục: lỗi validate → `RequestValidationError` (400, VALIDATION_ERROR). */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new RequestValidationError(flattenValidationErrors(errors)),
  });
}

/** Làm phẳng lỗi lồng nhau thành danh sách field, đường dẫn dạng `address.city`, `items.0.name`. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own: FieldError[] = error.constraints
      ? [{ field, errors: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}
