export const MAILER = Symbol('MAILER');

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Bản text thuần cho client không hiển thị HTML. */
  text: string;
}

/**
 * Gửi email. Không gọi bên trong `UnitOfWork.run`: commit xong mới gửi
 * (ARCHITECTURE §5 – không gọi API ngoài trong transaction).
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
