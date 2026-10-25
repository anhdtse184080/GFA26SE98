export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Lưu file nhị phân theo **khóa** (vd `products/<id>/thumbnail-<ts>.png`). DB chỉ lưu khóa, không lưu URL công khai;
 * client tải file qua API có kiểm tra quyền. Không gọi bên trong `UnitOfWork.run` (ARCHITECTURE §5).
 */
export interface FileStorage {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Không có file → `null`. */
  read(key: string): Promise<Buffer | null>;
  /** Không có file thì bỏ qua. */
  delete(key: string): Promise<void>;
}
