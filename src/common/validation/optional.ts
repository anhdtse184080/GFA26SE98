import { ValidateIf } from 'class-validator';

/**
 * Field PATCH có thể bỏ qua nhưng không được `null` (cột NOT NULL).
 * Khác `@IsOptional()`: `null` vẫn chạy các validator khác và bị từ chối.
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object, value) => value !== undefined);
