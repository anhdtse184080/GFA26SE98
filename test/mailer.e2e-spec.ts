import { Test } from '@nestjs/testing';
import { AppModule } from './../src/app.module.js';
import { MAILER, type Mailer } from './../src/common/ports/mailer.js';
import { LogMailer } from './../src/infrastructure/mail/log-mailer.js';
import { FakeMailer } from './support/fake-mailer.js';

// Cần chạy `npm run db:up` trước.
describe('MAILER provider (e2e)', () => {
  it('AppModule cung cấp Mailer theo MAIL_DRIVER (mặc định log)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      expect(app.get<Mailer>(MAILER)).toBeInstanceOf(LogMailer);
    } finally {
      await app.close();
    }
  });

  it('override bằng FakeMailer để test đọc lại email', async () => {
    const fakeMailer = new FakeMailer();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useValue(fakeMailer)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      await app.get<Mailer>(MAILER).send({
        to: 'e2e@example.com',
        subject: 'x',
        html: '<p>x</p>',
        text: 'x',
      });
      expect(fakeMailer.lastTo('e2e@example.com')?.subject).toBe('x');
    } finally {
      await app.close();
    }
  });
});
