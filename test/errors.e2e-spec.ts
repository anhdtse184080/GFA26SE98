import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
  Query,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { Public } from './../src/common/auth/decorators.js';
import { NotFoundError } from './../src/common/errors/index.js';
import { PaginationQueryDto } from './../src/common/pagination/pagination-query.dto.js';

class EchoDto {
  @IsEmail()
  email: string;
}

/** Controller chỉ dùng trong test để kiểm tra pipe/filter toàn cục; không có trong app thật. */
@Public()
@Controller('__test__/errors')
class ErrorsTestController {
  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }

  @Get('page')
  page(@Query() q: PaginationQueryDto) {
    return { page: q.page, limit: q.limit };
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundError('THING_NOT_FOUND', 'Không tìm thấy');
  }

  @Get('crash')
  crash() {
    throw new Error('connection password=secret');
  }
}

// Cần chạy `npm run db:up` trước.
describe('Global error handling (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrorsTestController],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('body hợp lệ → 201', () => {
    return request(app.getHttpServer())
      .post('/__test__/errors/echo')
      .send({ email: 'a@b.vn' })
      .expect(201)
      .expect({ email: 'a@b.vn' });
  });

  it('body sai → 400 VALIDATION_ERROR kèm danh sách field', () => {
    return request(app.getHttpServer())
      .post('/__test__/errors/echo')
      .send({ email: 'x', role: 'ADMIN' })
      .expect(400)
      .expect({
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu không hợp lệ',
        details: {
          fields: [
            { field: 'role', errors: ['property role should not exist'] },
            { field: 'email', errors: ['email must be an email'] },
          ],
        },
      });
  });

  it('body JSON sai cú pháp → 400 BAD_REQUEST', async () => {
    const res = await request(app.getHttpServer())
      .post('/__test__/errors/echo')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);

    expect(res.body).toMatchObject({ code: 'BAD_REQUEST', details: {} });
  });

  it('query phân trang được chuyển thành số', () => {
    return request(app.getHttpServer())
      .get('/__test__/errors/page?page=2&limit=100')
      .expect(200)
      .expect({ page: 2, limit: 100 });
  });

  it('limit > 100 → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get('/__test__/errors/page?limit=101')
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details.fields[0].field).toBe('limit');
  });

  it('NotFoundError → 404', () => {
    return request(app.getHttpServer())
      .get('/__test__/errors/not-found')
      .expect(404)
      .expect({
        code: 'THING_NOT_FOUND',
        message: 'Không tìm thấy',
        details: {},
      });
  });

  it('lỗi không xác định → 500 INTERNAL_ERROR, không lộ chi tiết', async () => {
    const res = await request(app.getHttpServer())
      .get('/__test__/errors/crash')
      .expect(500);

    expect(res.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Đã xảy ra lỗi hệ thống',
      details: {},
    });
    expect(res.text).not.toMatch(/secret|stack/);
  });

  it('route không tồn tại → 404 đúng format', async () => {
    const res = await request(app.getHttpServer())
      .get(`/khong-ton-tai-${Date.now()}`)
      .expect(404);

    expect(res.body).toMatchObject({ code: 'NOT_FOUND', details: {} });
  });
});
