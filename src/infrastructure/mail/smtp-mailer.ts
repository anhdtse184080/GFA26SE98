import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from '../../common/ports/mailer.js';

export interface SmtpMailerOptions {
  host: string;
  port: number;
  /** `true` cho cổng 465 (Gmail), `false` cho 587 (STARTTLS). */
  secure: boolean;
  user: string;
  /** Gmail: dùng App Password, không phải mật khẩu đăng nhập. */
  password: string;
  from: string;
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpMailerOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: { user: options.user, pass: options.password },
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  close(): void {
    this.transporter.close();
  }
}
