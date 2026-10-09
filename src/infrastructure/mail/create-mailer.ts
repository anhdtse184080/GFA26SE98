import type { Mailer } from '../../common/ports/mailer.js';
import type {
  EnvironmentVariables,
  MailDriver,
} from '../../config/env.validation.js';
import { LogMailer } from './log-mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

export type MailEnv = Pick<
  EnvironmentVariables,
  | 'MAIL_DRIVER'
  | 'MAIL_HOST'
  | 'MAIL_PORT'
  | 'MAIL_SECURE'
  | 'MAIL_USER'
  | 'MAIL_PASSWORD'
  | 'MAIL_FROM'
>;

// Thêm driver mới = thêm một entry, không sửa if/switch (OCP).
const MAILER_FACTORIES: Record<MailDriver, (env: MailEnv) => Mailer> = {
  log: () => new LogMailer(),
  // validateEnv đã bắt buộc đủ biến MAIL_* khi driver là smtp.
  smtp: (env) =>
    new SmtpMailer({
      host: env.MAIL_HOST!,
      port: env.MAIL_PORT!,
      secure: env.MAIL_SECURE!,
      user: env.MAIL_USER!,
      password: env.MAIL_PASSWORD!,
      from: env.MAIL_FROM!,
    }),
};

export function createMailer(env: MailEnv): Mailer {
  return MAILER_FACTORIES[env.MAIL_DRIVER](env);
}
