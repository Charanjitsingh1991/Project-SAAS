/** Pure Finance helpers (client-safe, no DB). */
import type { AccountType } from "./accounting";

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABEL: Record<AgingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

/** Bucket by whole days past due (≤ 0 means not yet due). */
export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

/** Same-state supply → CGST + SGST; otherwise IGST. A missing place of supply is treated as local. */
export function isIntraState(placeOfSupply: string | null | undefined, orgState: string | null | undefined) {
  if (!placeOfSupply || !orgState) return true;
  return placeOfSupply.trim().toLowerCase() === orgState.trim().toLowerCase();
}

/** Split a tax amount (minor units). CGST gets the rounded-down half so CGST + SGST === tax. */
export function splitGst(tax: number, intra: boolean) {
  if (!intra) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

/** Group invoice lines by GST rate → taxable value and tax, sorted by rate. */
export function taxByRate(lines: { taxRate: number; amount: number; taxAmount: number }[]) {
  const m = new Map<number, { rate: number; taxable: number; tax: number }>();
  for (const l of lines) {
    const row = m.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, tax: 0 };
    row.taxable += l.amount;
    row.tax += l.taxAmount;
    m.set(l.taxRate, row);
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate);
}

/** Display status: sent/partial invoices past their due date are "overdue". */
export function invoiceDisplayStatus(inv: { status: string; dueDate: string }, today: string) {
  return (inv.status === "sent" || inv.status === "partial") && inv.dueDate < today ? "overdue" : inv.status;
}

/** Natural-sign balance: assets & expenses are debit-normal, the rest credit-normal. */
export function naturalBalance(type: AccountType, debit: number, credit: number) {
  return type === "asset" || type === "expense" ? debit - credit : credit - debit;
}

/** Inclusive list of "YYYY-MM" months between two dates. */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const YMD = /^\d{4}-\d{2}-\d{2}$/;
