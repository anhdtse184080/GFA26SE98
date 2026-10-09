/** Gán các field có trong `patch` (bỏ qua `undefined`) vào `target`. Dùng cho PATCH profile. */
export function assignDefined<T extends object>(
  target: T,
  patch: Partial<T>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}
