import { extractOtp, FakeMailer } from '../fake-mailer.js';

const mail = (to: string, text: string) => ({
  to,
  subject: 'Test',
  html: `<p>${text}</p>`,
  text,
});

describe('FakeMailer', () => {
  it('lưu email theo thứ tự gửi', async () => {
    const mailer = new FakeMailer();
    await mailer.send(mail('a@example.com', 'một'));
    await mailer.send(mail('b@example.com', 'hai'));
    expect(mailer.sent.map((m) => m.text)).toEqual(['một', 'hai']);
  });

  it('lastTo trả email mới nhất của đúng người, không phân biệt hoa thường', async () => {
    const mailer = new FakeMailer();
    await mailer.send(mail('a@example.com', 'Mã OTP: 111111'));
    await mailer.send(mail('b@example.com', 'Mã OTP: 222222'));
    await mailer.send(mail('A@Example.com', 'Mã OTP: 333333'));

    expect(mailer.lastTo('a@EXAMPLE.com')?.text).toBe('Mã OTP: 333333');
    expect(mailer.lastTo('b@example.com')?.text).toBe('Mã OTP: 222222');
    expect(mailer.lastTo('c@example.com')).toBeUndefined();
  });

  it('clear xóa hết email đã lưu', async () => {
    const mailer = new FakeMailer();
    await mailer.send(mail('a@example.com', 'x'));
    mailer.clear();
    expect(mailer.sent).toHaveLength(0);
    expect(mailer.lastTo('a@example.com')).toBeUndefined();
  });

  it('extractOtp lấy mã 6 chữ số từ bản text', () => {
    expect(extractOtp(mail('a@example.com', 'Mã OTP: 048213\nHết hạn'))).toBe(
      '048213',
    );
    expect(extractOtp(mail('a@example.com', 'không có mã'))).toBeNull();
    expect(extractOtp(undefined)).toBeNull();
  });
});
