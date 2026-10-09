import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from '../dto/auth.dto.js';

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

describe('ForgotPasswordDto', () => {
  it('chuẩn hóa email; email sai → lỗi email', () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: ' Khach@Example.COM ',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.email).toBe('khach@example.com');

    const bad = plainToInstance(ForgotPasswordDto, { email: 'khong-phai' });
    expect(validateSync(bad).map((e) => e.property)).toEqual(['email']);
  });
});

describe('ResetPasswordDto', () => {
  const validReset = {
    email: ' Khach@Example.COM ',
    otp: '012345',
    newPassword: 'matkhaumoi1',
  };

  function validateReset(body: Record<string, unknown>) {
    const dto = plainToInstance(ResetPasswordDto, body);
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return { dto, fields: errors.map((e) => e.property) };
  }

  it('hợp lệ, email chuẩn hóa', () => {
    const { dto, fields } = validateReset(validReset);

    expect(fields).toEqual([]);
    expect(dto.email).toBe('khach@example.com');
  });

  it.each([
    ['ngắn hơn 8 ký tự', 'abc1234'],
    ['chỉ có chữ', 'matkhauxyz'],
    ['chỉ có số', '12345678'],
    ['dài hơn 72 ký tự', `a1${'x'.repeat(71)}`],
  ])('newPassword %s → lỗi newPassword (cùng quy tắc đăng ký)', (_c, pw) => {
    expect(validateReset({ ...validReset, newPassword: pw }).fields).toEqual([
      'newPassword',
    ]);
  });

  it.each(['12345', '1234567', '12a456', 123456])(
    'otp %s sai định dạng → lỗi otp',
    (otp) => {
      expect(validateReset({ ...validReset, otp }).fields).toEqual(['otp']);
    },
  );

  it('thiếu newPassword → lỗi newPassword', () => {
    const { newPassword: _n, ...rest } = validReset;
    expect(validateReset(rest).fields).toEqual(['newPassword']);
  });
});
