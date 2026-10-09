import { escapeHtml, type MailContent, renderLayout } from './mail-layout.js';

export function testMailEmail(driver: string, sentAt: Date): MailContent {
  const subject = 'Email thử – cấu hình gửi mail';
  const time = sentAt.toISOString();
  const html = renderLayout(
    subject,
    `    <p>Đây là email thử từ backend FA26SE095.</p>
    <p>Driver: <strong>${escapeHtml(driver)}</strong><br>Thời điểm gửi: ${escapeHtml(time)}</p>`,
  );
  const text = [
    'Đây là email thử từ backend FA26SE095.',
    `Driver: ${driver}`,
    `Thời điểm gửi: ${time}`,
  ].join('\n');
  return { subject, html, text };
}
