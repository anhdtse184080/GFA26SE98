import {
  escapeHtml,
  type MailContent,
  renderLayout,
  renderOtp,
} from './mail-layout.js';

export interface PasswordResetParams {
  fullName: string;
  otp: string;
  expiresInMinutes: number;
}

export function passwordResetEmail(params: PasswordResetParams): MailContent {
  const subject = 'Mã OTP đặt lại mật khẩu';
  const html = renderLayout(
    subject,
    `    <p>Xin chào ${escapeHtml(params.fullName)},</p>
    <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhập mã OTP dưới đây để tiếp tục:</p>
${renderOtp(params.otp)}
    <p>Mã có hiệu lực trong ${params.expiresInMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại vẫn giữ nguyên.</p>`,
  );
  const text = [
    `Xin chào ${params.fullName},`,
    '',
    'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhập mã OTP dưới đây để tiếp tục:',
    '',
    `Mã OTP: ${params.otp}`,
    '',
    `Mã có hiệu lực trong ${params.expiresInMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại vẫn giữ nguyên.`,
  ].join('\n');
  return { subject, html, text };
}
