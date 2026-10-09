import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAILER, type Mailer } from '../../common/ports/mailer.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { staffInvitationEmail } from '../../infrastructure/mail/templates/staff-invitation.template.js';
import { OTP_CONFIG, type OtpConfig } from '../otp/otp.config.js';
import { OtpService } from '../otp/otp.service.js';
import type { User } from './entities/user.entity.js';
import { ROLE_DISPLAY_NAMES, roleCodeOf } from './role-code.enum.js';

const MINUTES_PER_HOUR = 60;

/**
 * Gửi email mời kích hoạt (link `FRONTEND_URL/accept-invite` + OTP `ACCOUNT_ACTIVATION`
 * thời hạn `INVITE_OTP_TTL_HOURS`). Không kiểm tra user có đang chờ lời mời: nơi gọi kiểm tra
 * bằng `UserAccountPolicy`. Không gọi bên trong `UnitOfWork.run` (gửi email).
 */
@Injectable()
export class AccountInvitationService {
  private readonly frontendUrl: string;

  constructor(
    private readonly otp: OtpService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(OTP_CONFIG) private readonly otpConfig: OtpConfig,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.frontendUrl = config.get('FRONTEND_URL', { infer: true });
  }

  /** Phát OTP mới (vô hiệu OTP cũ) rồi gửi email lời mời. */
  async send(user: User): Promise<void> {
    const code = await this.otp.issue(
      user.id,
      'ACCOUNT_ACTIVATION',
      this.otpConfig.inviteTtlHours * MINUTES_PER_HOUR,
    );
    const mail = staffInvitationEmail({
      fullName: user.fullName,
      roleName: ROLE_DISPLAY_NAMES[roleCodeOf(user.roleId)],
      email: user.email,
      otp: code,
      expiresInHours: this.otpConfig.inviteTtlHours,
      frontendUrl: this.frontendUrl,
    });
    await this.mailer.send({ to: user.email, ...mail });
  }

  /**
   * Như `send` nhưng tôn trọng cooldown gửi lại.
   *
   * @throws TooManyRequestsError `OTP_RESEND_TOO_SOON`
   */
  async resend(user: User): Promise<void> {
    await this.otp.assertCanResend(user.id, 'ACCOUNT_ACTIVATION');
    await this.send(user);
  }
}
