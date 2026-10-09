import {
  escapeHtml,
  type MailContent,
  renderLayout,
  renderOtp,
} from './mail-layout.js';

export interface AccountActivationParams {
  fullName: string;
  otp: string;
  expiresInMinutes: number;
}

export function accountActivationEmail(
  params: AccountActivationParams,
): MailContent {
  const subject = 'Xác thực email kích hoạt tài khoản';
  const html = renderLayout(
    subject,
    `    <p>Xin chào ${escapeHtml(params.fullName)},</p>
    <p>Cảm ơn bạn đã đăng ký tài khoản. Nhập mã OTP dưới đây để kích hoạt tài khoản:</p>
${renderOtp(params.otp)}
    <p>Mã có hiệu lực trong ${params.expiresInMinutes} phút. Nếu bạn không đăng ký, hãy bỏ qua email này.</p>`,
  );
  const text = [
    `Xin chào ${params.fullName},`,
    '',
    'Cảm ơn bạn đã đăng ký tài khoản. Nhập mã OTP dưới đây để kích hoạt tài khoản:',
    '',
    `Mã OTP: ${params.otp}`,
    '',
    `Mã có hiệu lực trong ${params.expiresInMinutes} phút. Nếu bạn không đăng ký, hãy bỏ qua email này.`,
  ].join('\n');
  return { subject, html, text };
}
