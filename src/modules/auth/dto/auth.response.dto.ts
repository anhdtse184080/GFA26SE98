import { UserResponseDto } from '../../users/dto/users.response.dto.js';

/** Access token ngắn hạn + refresh token (gửi lại ở `/auth/refresh`, `/auth/logout`). */
export class TokenPairResponseDto {
  accessToken: string;
  refreshToken: string;
}

export class LoginResponseDto extends TokenPairResponseDto {
  user: UserResponseDto;
}

export class MessageResponseDto {
  message: string;
}

export class RegisterResponseDto extends MessageResponseDto {
  user: UserResponseDto;
}

/** Đổi mật khẩu xong token cũ hết hiệu lực; client thay bằng cặp token mới. */
export class ChangePasswordResponseDto extends LoginResponseDto {
  message: string;
}
