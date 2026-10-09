export type HealthStatus = 'up' | 'down';

export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');

/** Kiểm tra một phụ thuộc hạ tầng. Lỗi kết nối trả `'down'`, không ném. */
export interface HealthIndicator {
  readonly name: string;
  check(): Promise<HealthStatus>;
}
