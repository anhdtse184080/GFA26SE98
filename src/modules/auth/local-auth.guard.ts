import { type ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { UnauthorizedError } from '../../common/errors/index.js';
import { createValidationPipe } from '../../common/validation/validation.pipe.js';
import { LoginDto } from './dto/auth.dto.js';
import { LOCAL_STRATEGY } from './local.strategy.js';

/**
 * Guard của `POST /auth/login`. Guard chạy trước pipe nên validate/transform body (`LoginDto`) tại đây,
 * để passport-local luôn nhận email đã chuẩn hóa và lỗi validate vẫn là 400 `VALIDATION_ERROR`.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard(LOCAL_STRATEGY) {
  private readonly validation = createValidationPipe();

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    request.body = (await this.validation.transform(request.body, {
      type: 'body',
      metatype: LoginDto,
    })) as LoginDto;
    return (await super.canActivate(context)) as boolean;
  }

  override handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err) throw err;
    if (!user) {
      throw new UnauthorizedError(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không đúng',
      );
    }
    return user;
  }
}
