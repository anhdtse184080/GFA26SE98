import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { BcryptPasswordHasher } from '../infrastructure/bcrypt-password-hasher.js';
import { DxfCadFiles } from '../infrastructure/dxf-cad-files.js';
import {
  decodeGcsCredentials,
  GcsFileStorage,
} from '../infrastructure/gcs-file-storage.js';
import { createMailer } from '../infrastructure/mail/create-mailer.js';
import { PdfLibContractRenderer } from '../infrastructure/pdf/pdf-lib-contract-renderer.js';
import { SystemClock } from '../infrastructure/system-clock.js';
import { DomainExceptionFilter } from './filters/domain-exception.filter.js';
import { CAD_FILES } from './ports/cad-files.js';
import { CLOCK } from './ports/clock.js';
import { CONTRACT_PDF_RENDERER } from './ports/contract-pdf-renderer.js';
import { FILE_STORAGE } from './ports/file-storage.js';
import { MAILER } from './ports/mailer.js';
import { PASSWORD_HASHER } from './ports/password-hasher.js';
import { createValidationPipe } from './validation/validation.pipe.js';

@Global()
@Module({
  providers: [
    { provide: PASSWORD_HASHER, useFactory: () => new BcryptPasswordHasher() },
    { provide: CLOCK, useClass: SystemClock },
    { provide: CONTRACT_PDF_RENDERER, useClass: PdfLibContractRenderer },
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
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      // validateEnv đã kiểm tra GCS_CREDENTIALS_BASE64 giải mã được.
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new GcsFileStorage(
          config.get('GCS_BUCKET', { infer: true }),
          decodeGcsCredentials(
            config.get('GCS_CREDENTIALS_BASE64', { infer: true }),
          )!,
        ),
    },
    { provide: CAD_FILES, useClass: DxfCadFiles },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
  exports: [
    PASSWORD_HASHER,
    CLOCK,
    MAILER,
    FILE_STORAGE,
    CAD_FILES,
    CONTRACT_PDF_RENDERER,
  ],
})
export class CommonModule {}
