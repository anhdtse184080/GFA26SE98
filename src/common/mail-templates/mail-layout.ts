export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Khung HTML chung; `body` phải là HTML đã escape. */
export function renderLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
${body}
    <p style="margin-top:32px;font-size:12px;color:#888">Email này được gửi tự động, vui lòng không trả lời.</p>
  </div>
</body>
</html>`;
}

export function renderOtp(otp: string): string {
  return `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center;margin:24px 0">${escapeHtml(otp)}</p>`;
}
