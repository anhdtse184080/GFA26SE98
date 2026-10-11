// Chạy: `npm run mail:test -- <email>` (trên bản build trong dist/). Gửi một email thử qua MAIL_DRIVER đang cấu hình.
import { isEmail } from 'class-validator';
import { validateEnv } from '../../config/env.validation.js';
import { createMailer } from './create-mailer.js';
import { SmtpMailer } from './smtp-mailer.js';
import { testMailEmail } from '../../common/mail-templates/test-mail.template.js';

try {
  process.loadEnvFile();
} catch {
  // Không có file .env: dùng biến môi trường sẵn có của process.
}

const to = process.argv[2];
if (!to || !isEmail(to)) {
  console.error('[mail:test] Cách dùng: npm run mail:test -- <email>');
  process.exit(1);
}

const env = validateEnv(process.env);
const mailer = createMailer(env);
try {
  await mailer.send({ to, ...testMailEmail(env.MAIL_DRIVER, new Date()) });
  console.log(`[mail:test] Đã gửi qua driver "${env.MAIL_DRIVER}" tới ${to}`);
} finally {
  if (mailer instanceof SmtpMailer) mailer.close();
}
