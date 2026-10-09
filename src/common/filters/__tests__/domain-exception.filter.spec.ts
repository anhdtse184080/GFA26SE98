import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RequestValidationError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../errors/index.js';
import {
  DomainExceptionFilter,
  type ErrorResponseBody,
} from '../domain-exception.filter.js';

function run(exception: unknown) {
  const res = {
    statusCode: 0,
    body: undefined as ErrorResponseBody | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: ErrorResponseBody) {
      this.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;

  new DomainExceptionFilter().catch(exception, host);
  return { status: res.statusCode, body: res.body };
}

describe('DomainExceptionFilter', () => {
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [new NotFoundError('CONTRACT_NOT_FOUND'), HttpStatus.NOT_FOUND],
    [new ConflictError('EMAIL_ALREADY_EXISTS'), HttpStatus.CONFLICT],
    [new ForbiddenError('PROJECT_ACCESS_DENIED'), HttpStatus.FORBIDDEN],
    [new UnauthorizedError('INVALID_CREDENTIALS'), HttpStatus.UNAUTHORIZED],
    [
      new BusinessRuleError('REVISION_LIMIT_REACHED'),
      HttpStatus.UNPROCESSABLE_ENTITY,
    ],
    [
      new TooManyRequestsError('OTP_RESEND_TOO_SOON'),
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  ])('map %s sang status %i', (error, status) => {
    const result = run(error);

    expect(result.status).toBe(status);
    expect(result.body).toEqual({
      code: error.code,
      message: error.code,
      details: {},
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('giữ message và details của lỗi domain', () => {
    const result = run(
      new BusinessRuleError('REVISION_LIMIT_REACHED', 'Hết lượt sửa', {
        max: 3,
      }),
    );

    expect(result.body).toEqual({
      code: 'REVISION_LIMIT_REACHED',
      message: 'Hết lượt sửa',
      details: { max: 3 },
    });
  });

  it('lỗi validate → 400 VALIDATION_ERROR kèm danh sách field', () => {
    const fields = [{ field: 'email', errors: ['email must be an email'] }];

    const result = run(new RequestValidationError(fields));

    expect(result.status).toBe(HttpStatus.BAD_REQUEST);
    expect(result.body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu không hợp lệ',
      details: { fields },
    });
  });

  it('HttpException 4xx của Nest giữ status, code theo tên status', () => {
    expect(run(new NotFoundException('Cannot GET /x'))).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Cannot GET /x', details: {} },
    });
    expect(run(new ForbiddenException()).body?.code).toBe('FORBIDDEN');
    expect(run(new BadRequestException(['a', 'b'])).body?.message).toBe('a; b');
  });

  it('lỗi client của Express (http-errors, expose=true) giữ status 4xx', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
    });

    expect(run(parseError)).toEqual({
      status: 400,
      body: { code: 'BAD_REQUEST', message: 'Unexpected token', details: {} },
    });
  });

  it.each([
    ['Error thường', new Error('db password=secret leaked')],
    ['HttpException 5xx', new ServiceUnavailableException('internal detail')],
    ['giá trị không phải Error', 'boom'],
    [
      'DomainError chưa được map',
      new (class OtherError extends DomainError {})('SOMETHING'),
    ],
  ])('%s → 500 INTERNAL_ERROR, không lộ chi tiết, có log', (_, error) => {
    const result = run(error);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Đã xảy ra lỗi hệ thống',
      details: {},
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /secret|internal detail|SOMETHING|boom/,
    );
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('log kèm stack trace của lỗi không xác định', () => {
    const error = new Error('boom');

    run(error);

    expect(logError).toHaveBeenCalledWith('boom', error.stack);
  });
});
