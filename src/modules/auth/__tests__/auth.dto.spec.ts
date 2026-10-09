import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto, RegisterDto } from '../dto/auth.dto.js';

function validateRegister(body: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, body);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((e) => e.property) };
}

const valid = {
  email: '  Khach.Hang@Example.COM ',
  fullName: '  Nguyễn Văn A ',
  password: 'matkhau123',
};

describe('RegisterDto', () => {
  it('chuẩn hóa email (trim + lowercase) và trim họ tên', () => {
    const { dto, fields } = validateRegister(valid);

    expect(fields).toEqual([]);
    expect(dto.email).toBe('khach.hang@example.com');
    expect(dto.fullName).toBe('Nguyễn Văn A');
  });

  it.each([
    ['ngắn hơn 8 ký tự', 'abc1234'],
    ['chỉ có chữ', 'matkhauxyz'],
    ['chỉ có số', '12345678'],
  ])('mật khẩu %s → lỗi password', (_case, password) => {
    expect(validateRegister({ ...valid, password }).fields).toEqual([
      'password',
    ]);
  });

  it('mật khẩu có chữ tiếng Việt và số hợp lệ', () => {
    expect(validateRegister({ ...valid, password: 'mậtkhẩu1' }).fields).toEqual(
      [],
    );
  });

  it('phone tùy chọn, sai định dạng → lỗi phone', () => {
    expect(validateRegister({ ...valid, phone: '0901234567' }).fields).toEqual(
      [],
    );
    expect(validateRegister({ ...valid, phone: '09-01' }).fields).toEqual([
      'phone',
    ]);
  });

  it('gửi field role → bị từ chối (forbidNonWhitelisted)', () => {
    expect(validateRegister({ ...valid, role: 'ADMIN' }).fields).toEqual([
      'role',
    ]);
  });
});

describe('LoginDto', () => {
  it('chuẩn hóa email', () => {
    const dto = plainToInstance(LoginDto, { email: ' A@B.COM', password: 'x' });
    expect(dto.email).toBe('a@b.com');
  });
});
