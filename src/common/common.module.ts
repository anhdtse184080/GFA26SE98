import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { BcryptPasswordHasher } from '../infrastructure/bcrypt-password-hasher.js';
import { createMailer } from '../infrastructure/mail/create-mailer.js';
import { SystemClock } from '../infrastructure/system-clock.js';
import { DomainExceptionFilter } from './filters/domain-exception.filter.js';
import { CLOCK } from './ports/clock.js';
import { MAILER } from './ports/mailer.js';
import { PASSWORD_HASHER } from './ports/password-hasher.js';
import { createValidationPipe } from './validation/validation.pipe.js';

@Global()
@Module({
  providers: [
    { provide: PASSWORD_HASHER, useFactory: () => new BcryptPasswordHasher() },
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        createMailer({
          MAIL_DRIVER: config.get('MAIL_DRIVER', { infer: true }),
          MAIL_HOST: config.get('MAIL_HOST', { infer: true }),
          MAIL_PORT: config.get('MAIL_PORT', { infer: true }),
          MAIL_SECURE: config.get('MAIL_SECURE', { infer: true }),
          MAIL_USER: config.get('MAIL_USER', { infer: true }),
          MAIL_PASSWORD: config.get('MAIL_PASSWORD', { infer: true }),
          MAIL_FROM: config.get('MAIL_FROM', { infer: true }),
        }),
    },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
  exports: [PASSWORD_HASHER, CLOCK, MAILER],
})
export class CommonModule {}
