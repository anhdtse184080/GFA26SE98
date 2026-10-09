import { UserResponseDto } from '../../users/dto/user.response.dto.js';

export class LoginResponseDto {
  accessToken: string;
  user: UserResponseDto;
}

export class MessageResponseDto {
  message: string;
}

export class RegisterResponseDto extends MessageResponseDto {
  user: UserResponseDto;
}

/** Đổi mật khẩu xong token cũ hết hiệu lực; client thay bằng `accessToken` mới. */
export class ChangePasswordResponseDto extends LoginResponseDto {
  message: string;
}
