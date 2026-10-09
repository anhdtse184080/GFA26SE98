export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
