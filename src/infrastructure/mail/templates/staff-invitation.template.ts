import {
  escapeHtml,
  type MailContent,
  renderLayout,
  renderOtp,
} from './mail-layout.js';

export interface StaffInvitationParams {
  fullName: string;
  /** Tên vai trò hiển thị, ví dụ "Nhân viên dự án", "Nhà thiết kế", "Nhà cung cấp". */
  roleName: string;
  email: string;
  otp: string;
  expiresInMinutes: number;
  frontendUrl: string;
}

export function buildActivationLink(frontendUrl: string, email: string) {
  return `${frontendUrl.replace(/\/+$/, '')}/activate?email=${encodeURIComponent(email)}`;
}

/** Email mời Staff/Designer/Supplier do Admin tạo: mở link, nhập OTP và tự đặt mật khẩu. */
export function staffInvitationEmail(
  params: StaffInvitationParams,
): MailContent {
  const subject = 'Lời mời kích hoạt tài khoản';
  const link = buildActivationLink(params.frontendUrl, params.email);
  const html = renderLayout(
    subject,
    `    <p>Xin chào ${escapeHtml(params.fullName)},</p>
    <p>Bạn được mời tham gia hệ thống với vai trò <strong>${escapeHtml(params.roleName)}</strong>.</p>
    <p>Mở liên kết dưới đây, nhập mã OTP và tự đặt mật khẩu để kích hoạt tài khoản:</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${escapeHtml(link)}" style="background:#2b6cb0;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Kích hoạt tài khoản</a>
    </p>
${renderOtp(params.otp)}
    <p>Mã có hiệu lực trong ${params.expiresInMinutes} phút.</p>
    <p style="font-size:12px;color:#666">Nếu nút không hoạt động, sao chép liên kết: ${escapeHtml(link)}</p>`,
  );
  const text = [
    `Xin chào ${params.fullName},`,
    '',
    `Bạn được mời tham gia hệ thống với vai trò ${params.roleName}.`,
    'Mở liên kết dưới đây, nhập mã OTP và tự đặt mật khẩu để kích hoạt tài khoản:',
    '',
    link,
    '',
    `Mã OTP: ${params.otp}`,
    '',
    `Mã có hiệu lực trong ${params.expiresInMinutes} phút.`,
  ].join('\n');
  return { subject, html, text };
}
