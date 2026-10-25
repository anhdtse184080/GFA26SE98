import {
  type CallHandler,
  type ExecutionContext,
  mixin,
  type NestInterceptor,
  ParseFilePipe,
  PayloadTooLargeException,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { type DomainError, RequestValidationError } from '../errors/index.js';

/** File multipart đã đọc vào bộ nhớ (multer memory storage). */
export interface UploadedFileData {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
}

/**
 * Nhận đúng một file ở field `field`, giữ trong bộ nhớ, tối đa `maxBytes`.
 * Multer dừng đọc ngay khi vượt giới hạn; lỗi đó được đổi thành `tooLarge()` (lỗi domain của module)
 * thay cho 413 mặc định. Sai tên field / nhiều file → 400.
 */
export function SingleFileUpload(
  field: string,
  maxBytes: number,
  tooLarge: () => DomainError,
): Type<NestInterceptor> {
  const Base = FileInterceptor(field, {
    limits: { fileSize: maxBytes, files: 1 },
  });

  class SingleFileUploadInterceptor extends Base {
    override async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      try {
        return await super.intercept(context, next);
      } catch (error) {
        if (error instanceof PayloadTooLargeException) throw tooLarge();
        throw error;
      }
    }
  }
  return mixin(SingleFileUploadInterceptor);
}

/** Pipe cho `@UploadedFile()`: thiếu file → 400 VALIDATION_ERROR. Định dạng/nội dung do service kiểm tra. */
export function requiredFile(field = 'file'): ParseFilePipe {
  return new ParseFilePipe({
    fileIsRequired: true,
    exceptionFactory: () =>
      new RequestValidationError([
        { field, errors: [`${field} là bắt buộc (multipart/form-data)`] },
      ]),
  });
}
