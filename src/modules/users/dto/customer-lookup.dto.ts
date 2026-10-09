import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../../common/validation/transforms.js';

export class CustomerLookupQueryDto {
  /** @example customer@example.com */
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(255)
  email: string;
}
