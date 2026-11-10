/** Pure quote helpers (no I/O) — safe for server, client and tests. */
import type { CountryPack, TaxRateOption } from "./countries";
import { taxOf } from "./money";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "invoiced";

export type QuoteLineInput = {
  productId?: number | null;
  description: string;
  quantity: number;
  /** Minor units, before discount. */
  unitPrice: number;
  discountPercent: number;
  taxCode: string;
};

export type ComputedQuoteLine = QuoteLineInput & { taxRate: number; amount: number; taxAmount: number; sortOrder: number };

/** Resolve a tax code against the country's rate table (falls back to the first rate). */
export function rateFor(rates: readonly TaxRateOption[], code: string | null | undefined) {
  return rates.find((r) => r.code === code) ?? rates[0];
}

/**
 * Line amounts in minor units. Discount is applied to the unit price first (rounded),
 * matching how convertQuoteToInvoice builds invoice lines, so quote and invoice totals agree.
 */
export function computeQuoteLines(rates: readonly TaxRateOption[], lines: QuoteLineInput[]) {
  const out: ComputedQuoteLine[] = lines.map((l, i) => {
    const opt = rateFor(rates, l.taxCode);
    const taxRate = opt.kind === "standard" ? opt.rate : 0;
    const net = Math.round(l.unitPrice * (1 - (l.discountPercent || 0) / 100));
    const amount = Math.round(l.quantity * net);
    return { ...l, taxCode: opt.code, taxRate, amount, taxAmount: taxOf(amount, taxRate), sortOrder: i };
  });
  const subtotal = out.reduce((s, l) => s + l.amount, 0);
  const taxTotal = out.reduce((s, l) => s + l.taxAmount, 0);
  return { lines: out, subtotal, taxTotal, total: subtotal + taxTotal };
}

/** Tax lines for display, grouped by rate and split per country rules (India CGST+SGST / IGST; UAE single VAT line). */
export function quoteTaxLines(pack: CountryPack, lines: { taxRate: number; taxAmount: number }[], placeOfSupply: string | null | undefined, orgRegion: string | null | undefined) {
  const byRate = new Map<number, number>();
  for (const l of lines) if (l.taxAmount) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + l.taxAmount);
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).flatMap(([rate, amount]) => pack.tax.split(amount, rate, placeOfSupply, orgRegion));
}

/** Sent/draft quotes past their validity date display as expired. */
export function quoteDisplayStatus(q: { status: string; validUntil: string }, today: string): QuoteStatus {
  if ((q.status === "sent" || q.status === "draft") && q.validUntil < today) return "expired";
  return q.status as QuoteStatus;
}

/** Manual status changes (invoiced is only reached through conversion). */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "declined", "draft"],
  accepted: ["draft"],
  declined: ["draft"],
  expired: ["draft"],
  invoiced: [],
};

/** Whether a quote (by its displayed status) may move to `to`. */
export function canMoveQuote(display: QuoteStatus, to: QuoteStatus) {
  return QUOTE_TRANSITIONS[display].includes(to);
}

/** Conversion is allowed for accepted quotes and for sent quotes still within validity. */
export function canConvertQuote(display: QuoteStatus) {
  return display === "accepted" || display === "sent";
}
