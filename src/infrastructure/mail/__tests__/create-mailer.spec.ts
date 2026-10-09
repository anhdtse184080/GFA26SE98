import { createMailer, type MailEnv } from '../create-mailer.js';
import { LogMailer } from '../log-mailer.js';
import { SmtpMailer } from '../smtp-mailer.js';

describe('createMailer', () => {
  it('MAIL_DRIVER=log → LogMailer', () => {
    expect(createMailer({ MAIL_DRIVER: 'log' })).toBeInstanceOf(LogMailer);
  });

  it('MAIL_DRIVER=smtp → SmtpMailer (chỉ tạo transporter, không kết nối)', () => {
    const env: MailEnv = {
      MAIL_DRIVER: 'smtp',
      MAIL_HOST: 'smtp.gmail.com',
      MAIL_PORT: 465,
      MAIL_SECURE: true,
      MAIL_USER: 'user@gmail.com',
      MAIL_PASSWORD: 'app-password',
      MAIL_FROM: 'FA26SE095 <user@gmail.com>',
    };
    const mailer = createMailer(env);
    expect(mailer).toBeInstanceOf(SmtpMailer);
    (mailer as SmtpMailer).close();
  });
});
