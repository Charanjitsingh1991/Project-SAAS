/** Next agent after `last` in ascending id order, wrapping around. `last` may no longer be in the pool. */
export function pickNext(pool: readonly number[], last: number | null | undefined): number | null {
  const ids = [...new Set(pool)].sort((a, b) => a - b);
  if (ids.length === 0) return null;
  if (last == null) return ids[0];
  return ids.find((id) => id > last) ?? ids[0];
}

export function parseUserIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}
