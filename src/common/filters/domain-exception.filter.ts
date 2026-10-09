import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RequestValidationError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../errors/index.js';

export interface ErrorResponseBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

type DomainErrorClass = abstract new (...args: never[]) => DomainError;

/** Thêm loại lỗi domain mới = thêm một dòng ở đây. */
const DOMAIN_STATUS: ReadonlyArray<[DomainErrorClass, HttpStatus]> = [
  [RequestValidationError, HttpStatus.BAD_REQUEST],
  [UnauthorizedError, HttpStatus.UNAUTHORIZED],
  [ForbiddenError, HttpStatus.FORBIDDEN],
  [NotFoundError, HttpStatus.NOT_FOUND],
  [ConflictError, HttpStatus.CONFLICT],
  [BusinessRuleError, HttpStatus.UNPROCESSABLE_ENTITY],
  [TooManyRequestsError, HttpStatus.TOO_MANY_REQUESTS],
];

/** Chuyển mọi lỗi sang `{ code, message, details }`. Lỗi không xác định → 500, không lộ stack. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ErrorResponseBody] {
    if (exception instanceof DomainError) {
      const status =
        DOMAIN_STATUS.find(([cls]) => exception instanceof cls)?.[1] ??
        HttpStatus.INTERNAL_SERVER_ERROR;
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        return this.internalError(exception);
      }
      return [
        status,
        {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      ];
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        return this.internalError(exception);
      }
      return [
        status,
        {
          code: statusCode(status),
          message: httpExceptionMessage(exception),
          details: {},
        },
      ];
    }

    // Lỗi client của middleware Express (vd. body JSON sai cú pháp) theo quy ước http-errors.
    const clientStatus = exposedClientStatus(exception);
    if (clientStatus !== null) {
      return [
        clientStatus,
        {
          code: statusCode(clientStatus),
          message: (exception as Error).message,
          details: {},
        },
      ];
    }

    return this.internalError(exception);
  }

  private internalError(exception: unknown): [number, ErrorResponseBody] {
    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      {
        code: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi hệ thống',
        details: {},
      },
    ];
  }
}

function statusCode(status: number): string {
  const name = HttpStatus[status] as string | undefined;
  return name ?? `HTTP_${status}`;
}

function httpExceptionMessage(exception: HttpException): string {
  const res = exception.getResponse();
  if (typeof res === 'string') return res;
  const message = (res as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string') return message;
  return exception.message;
}

function exposedClientStatus(exception: unknown): number | null {
  if (!(exception instanceof Error)) return null;
  const { status, expose } = exception as Error & {
    status?: unknown;
    expose?: unknown;
  };
  if (
    expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    return status;
  }
  return null;
}
