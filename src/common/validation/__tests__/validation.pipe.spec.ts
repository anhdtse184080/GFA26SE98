import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { RequestValidationError } from '../../errors/index.js';
import { PaginationQueryDto } from '../../pagination/pagination-query.dto.js';
import { createValidationPipe } from '../validation.pipe.js';

class AddressDto {
  @IsString()
  @IsNotEmpty()
  city: string;
}

class SampleDto {
  @IsEmail()
  email: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;
}

const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});
const query = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'query',
  metatype,
});

async function validationError(
  value: unknown,
  metadata: ArgumentMetadata,
): Promise<RequestValidationError> {
  try {
    await createValidationPipe().transform(value, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(RequestValidationError);
    return error as RequestValidationError;
  }
  throw new Error('Expected validation to fail');
}

describe('createValidationPipe', () => {
  it('trả RequestValidationError với danh sách field, gồm field lồng nhau', async () => {
    const error = await validationError(
      { email: 'not-an-email', address: { city: '' } },
      body(SampleDto),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.fields).toEqual([
      { field: 'email', errors: ['email must be an email'] },
      { field: 'address.city', errors: ['city should not be empty'] },
    ]);
  });

  it('từ chối field không khai báo trong DTO', async () => {
    const error = await validationError(
      { email: 'a@b.vn', address: { city: 'HN' }, role: 'ADMIN' },
      body(SampleDto),
    );

    expect(error.details.fields).toEqual([
      { field: 'role', errors: ['property role should not exist'] },
    ]);
  });

  it('dữ liệu hợp lệ được chuyển thành instance DTO', async () => {
    const result: unknown = await createValidationPipe().transform(
      { email: 'a@b.vn', address: { city: 'HN' } },
      body(SampleDto),
    );

    expect(result).toBeInstanceOf(SampleDto);
  });
});

describe('PaginationQueryDto', () => {
  it('mặc định page=1, limit=20', async () => {
    const result = (await createValidationPipe().transform(
      {},
      query(PaginationQueryDto),
    )) as PaginationQueryDto;

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.skip).toBe(0);
  });

  it('chuyển chuỗi query thành số', async () => {
    const result = (await createValidationPipe().transform(
      { page: '3', limit: '50' },
      query(PaginationQueryDto),
    )) as PaginationQueryDto;

    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
    expect(result.skip).toBe(100);
  });

  it.each([
    [{ limit: '101' }, 'limit'],
    [{ limit: '0' }, 'limit'],
    [{ page: '0' }, 'page'],
    [{ page: 'abc' }, 'page'],
  ])('từ chối %o', async (value, field) => {
    const error = await validationError(value, query(PaginationQueryDto));

    expect(error.details.fields).toEqual([expect.objectContaining({ field })]);
  });
});
