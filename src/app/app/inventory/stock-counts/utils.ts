/** Pure stock-count helpers (no I/O). */

export type CountLine = { expectedQty: number; countedQty: number | null; cost: number };

/** Variance vs the snapshot; null while the line is uncounted. */
export function lineVariance(l: { expectedQty: number; countedQty: number | null }) {
  return l.countedQty === null ? null : l.countedQty - l.expectedQty;
}

/** Totals for a count: progress plus signed variance value at weighted-average cost (minor units). */
export function countSummary(lines: CountLine[]) {
  let counted = 0;
  let withVariance = 0;
  let gain = 0;
  let loss = 0;
  for (const l of lines) {
    const v = lineVariance(l);
    if (v === null) continue;
    counted++;
    if (Math.abs(v) < 1e-9) continue;
    withVariance++;
    const value = Math.round(v * l.cost);
    if (value > 0) gain += value;
    else loss += value;
  }
  return { total: lines.length, counted, withVariance, gain, loss, net: gain + loss };
}

/** Parse a counted-quantity form value: blank → null (not counted), otherwise a finite number ≥ 0. */
export function parseCounted(raw: string | null | undefined): number | null | "invalid" {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}
