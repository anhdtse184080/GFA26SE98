import type { RoleCode } from './role-code.js';

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
  /** Phiên đăng nhập (`users.session_id`); lệch → token bị thu hồi (đã logout / đăng nhập nơi khác). */
  sid: string;
}
