export const OTP_PURPOSES = ['ACCOUNT_ACTIVATION', 'PASSWORD_RESET'] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const OTP_CHANNELS = ['EMAIL', 'SMS'] as const;

export type OtpChannel = (typeof OTP_CHANNELS)[number];
