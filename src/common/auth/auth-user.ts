import type { RoleCode } from '../../modules/users/role-code.enum.js';

/** User đã xác thực, gắn vào `request.user` sau khi JwtAuthGuard kiểm tra token và trạng thái trong DB. */
export interface AuthUser {
  id: string;
  email: string;
  role: RoleCode;
}

/** Payload của access token. */
export interface JwtPayload {
  sub: string;
  role: RoleCode;
  /** Dấu vân tay `password_hash` lúc phát hành; lệch → token bị thu hồi (đã đổi mật khẩu). */
  pwv: string;
}
