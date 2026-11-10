/** Pure inventory helpers (no I/O) — safe for server and client. */

export const COVER_WINDOW_DAYS = 30;
export const RISK_COVER_DAYS = 14;

/** Days of stock left at the 30-day average outflow; null when nothing moved out (no forecast). */
export function daysOfCover(onHand: number, outflow30: number, windowDays = COVER_WINDOW_DAYS) {
  if (outflow30 <= 0) return null;
  if (onHand <= 0) return 0;
  return onHand / (outflow30 / windowDays);
}

export function isStockOutRisk(onHand: number, outflow30: number) {
  const c = daysOfCover(onHand, outflow30);
  return c !== null && c < RISK_COVER_DAYS;
}

/** Low when at/below the reorder level; products with no level are only flagged when negative. */
export function isLowStock(onHand: number, reorderLevel: number) {
  return reorderLevel > 0 ? onHand <= reorderLevel : onHand < 0;
}

/** Margin on selling price as a percentage; null when there is no price. */
export function marginPct(cost: number, price: number) {
  if (price <= 0) return null;
  return ((price - cost) / price) * 100;
}

export function suggestedQty(onHand: number, reorderLevel: number, reorderQty: number) {
  return Math.max(reorderQty, reorderLevel - onHand, 0);
}

export function fmtQty(n: number) {
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export type ReorderItem = { productId: number; preferredVendorId: number | null };

/** Groups reorder candidates by preferred vendor; the no-vendor group (key null) sorts last. */
export function groupByVendor<T extends ReorderItem>(items: T[]) {
  const map = new Map<number | null, T[]>();
  for (const it of items) {
    const k = it.preferredVendorId ?? null;
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()]
    .map(([vendorId, rows]) => ({ vendorId, rows }))
    .sort((a, b) => (a.vendorId === null ? 1 : b.vendorId === null ? -1 : a.vendorId - b.vendorId));
}

export type PoLineInput = { productId: number; quantity: number; unitCost: number; taxRate: number };

/** Per-line amount/tax (rounded once per line) and PO totals, all minor units. */
export function computePoTotals(lines: PoLineInput[], taxOf: (amount: number, rate: number) => number) {
  const out = lines.map((l) => {
    const amount = Math.round(l.quantity * l.unitCost);
    return { ...l, amount, taxAmount: taxOf(amount, l.taxRate) };
  });
  const subtotal = out.reduce((s, l) => s + l.amount, 0);
  const taxTotal = out.reduce((s, l) => s + l.taxAmount, 0);
  return { lines: out, subtotal, taxTotal, total: subtotal + taxTotal };
}

/** Running balance per movement (oldest → newest input), returned in the same order. */
export function withRunningBalance<T extends { quantity: number }>(asc: T[]) {
  let bal = 0;
  return asc.map((m) => ({ ...m, balance: (bal += m.quantity) }));
}
