import { Logger } from '@nestjs/common';
import { LogMailer } from '../log-mailer.js';

describe('LogMailer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('in người nhận, tiêu đề và bản text ra log, không gửi thật', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await expect(
      new LogMailer().send({
        to: 'a@example.com',
        subject: 'Xác thực email',
        html: '<p>Mã OTP: 123456</p>',
        text: 'Mã OTP: 123456',
      }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    const output = String(log.mock.calls[0][0]);
    expect(output).toContain('to=a@example.com');
    expect(output).toContain('subject=Xác thực email');
    expect(output).toContain('Mã OTP: 123456');
  });
});
