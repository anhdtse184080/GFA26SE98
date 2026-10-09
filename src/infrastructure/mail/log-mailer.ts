import { Logger } from '@nestjs/common';
import type { Mailer, MailMessage } from '../../common/ports/mailer.js';

/** Không gửi thật, chỉ in email ra log (dev, smoke test). Bản text đủ để đọc OTP. */
export class LogMailer implements Mailer {
  private readonly logger = new Logger('LogMailer');

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `to=${message.to} | subject=${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}
