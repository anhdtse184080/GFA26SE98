export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/** Tham số phân trang truyền từ service xuống repository. */
export interface PageRequest {
  page: number;
  limit: number;
}
