import { accountActivationEmail } from '../templates/account-activation.template.js';
import { passwordResetEmail } from '../templates/password-reset.template.js';
import {
  buildActivationLink,
  staffInvitationEmail,
} from '../templates/staff-invitation.template.js';

const base = { fullName: 'Nguyễn Văn A', otp: '123456', expiresInMinutes: 10 };

describe('mail templates', () => {
  it.each([
    ['kích hoạt tài khoản', accountActivationEmail(base)],
    ['đặt lại mật khẩu', passwordResetEmail(base)],
    [
      'mời nhân viên/đối tác',
      staffInvitationEmail({
        ...base,
        roleName: 'Nhà thiết kế',
        email: 'a@example.com',
        frontendUrl: 'http://localhost:3001',
      }),
    ],
  ])('%s: có tiêu đề, OTP và thời hạn ở cả html lẫn text', (_name, mail) => {
    expect(mail.subject).not.toBe('');
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('123456');
      expect(body).toContain('10 phút');
      expect(body).toContain('Nguyễn Văn A');
    }
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });

  it('lời mời có link FRONTEND_URL/activate kèm email đã encode', () => {
    const mail = staffInvitationEmail({
      ...base,
      roleName: 'Nhà cung cấp',
      email: 'a+b@example.com',
      frontendUrl: 'https://app.example.com/',
    });
    const link = 'https://app.example.com/activate?email=a%2Bb%40example.com';
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
    expect(mail.html).toContain('Nhà cung cấp');
  });

  it('buildActivationLink bỏ dấu / thừa ở cuối FRONTEND_URL', () => {
    expect(buildActivationLink('http://localhost:3001//', 'x@y.z')).toBe(
      'http://localhost:3001/activate?email=x%40y.z',
    );
  });

  it('escape tên người dùng trong html', () => {
    const mail = accountActivationEmail({
      ...base,
      fullName: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
