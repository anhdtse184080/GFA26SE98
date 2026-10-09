export const CLOCK = Symbol('CLOCK');

/** Nguồn thời gian hiện tại; test thay bằng clock cố định. */
export interface Clock {
  now(): Date;
}
