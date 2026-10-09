/** Biểu thức CHECK cho cột enum lưu VARCHAR: `"status" IN ('A', 'B')`. Chỉ dùng cho entity, migration viết literal. */
export function sqlIn(column: string, values: readonly string[]): string {
  return `"${column}" IN (${values.map((v) => `'${v}'`).join(', ')})`;
}
