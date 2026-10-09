import type { Mailer, MailMessage } from '../../src/common/ports/mailer.js';

/**
 * Mailer cho test: lưu email trong bộ nhớ thay vì gửi.
 * E2E: `.overrideProvider(MAILER).useValue(fakeMailer)`, rồi đọc OTP qua `lastTo` + `extractOtp`.
 */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Email gửi gần nhất tới địa chỉ này (không phân biệt hoa thường). */
  lastTo(email: string): MailMessage | undefined {
    const target = email.toLowerCase();
    return this.sent.findLast((m) => m.to.toLowerCase() === target);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Lấy mã OTP 6 chữ số từ bản text của email. */
export function extractOtp(message: MailMessage | undefined): string | null {
  return message?.text.match(/\b\d{6}\b/)?.[0] ?? null;
}
