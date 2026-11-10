/**
 * Pure tax-return aggregation (client-safe, no DB). Callers load sent/partial/paid invoices, credit notes and
 * expenses for the period; these functions only sum them. Results are estimates for review, not filed returns.
 */
import type { CountryPack } from "./countries";
import { isIntraState, lineTaxOption, splitGst } from "./finance-utils";

export type ReturnLine = { taxCode: string | null; taxRate: number; amount: number; taxAmount: number };
/** An invoice or credit note. Credit notes carry their invoice's place of supply. */
export type ReturnDoc = { placeOfSupply: string | null; lines: ReturnLine[] };
export type ReturnExpense = { amount: number; taxAmount: number };
export type TaxReturnInput = { orgRegion: string | null; invoices: ReturnDoc[]; creditNotes: ReturnDoc[]; expenses: ReturnExpense[] };

export type Amounts = { taxable: number; tax: number };

export type GstRateRow = { code: string; label: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number };
export type GstReturn = {
  kind: "GST";
  /** Standard-rated outward supplies by rate (net of credit notes). */
  byRate: GstRateRow[];
  outward: { taxable: number; cgst: number; sgst: number; igst: number; tax: number };
  interState: { taxable: number; igst: number };
  nilRated: number;
  exempt: number;
  creditNotes: Amounts;
  /** Input tax credit from bills/expenses (not split by head — vendor state isn't recorded). */
  itc: Amounts;
  /** Output tax − ITC; negative means credit carried forward. */
  net: number;
};

export type VatEmirateRow = { emirate: string; taxable: number; vat: number };
export type VatReturn = {
  kind: "VAT";
  /** Box 1a–1g: standard-rated supplies by emirate. */
  byEmirate: VatEmirateRow[];
  standard: { taxable: number; vat: number };
  /** Box 4 and 5. */
  zeroRated: number;
  exempt: number;
  creditNotes: Amounts;
  /** Box 8. */
  totalSupplies: { taxable: number; vat: number };
  /** Box 9: standard-rated expenses and recoverable VAT. */
  expenses: { taxable: number; vat: number };
  /** Box 14: payable (+) or refundable (−). */
  net: number;
};

export type TaxReturn = GstReturn | VatReturn;

const UNASSIGNED = "Unassigned";

function signedDocs(input: TaxReturnInput) {
  return [...input.invoices.map((d) => ({ d, sign: 1 })), ...input.creditNotes.map((d) => ({ d, sign: -1 }))];
}

function inputTax(expenses: ReturnExpense[]): Amounts {
  const taxed = expenses.filter((e) => e.taxAmount > 0);
  return { taxable: taxed.reduce((s, e) => s + e.amount, 0), tax: taxed.reduce((s, e) => s + e.taxAmount, 0) };
}

function creditTotals(docs: ReturnDoc[]): Amounts {
  const lines = docs.flatMap((d) => d.lines);
  return { taxable: lines.reduce((s, l) => s + l.amount, 0), tax: lines.reduce((s, l) => s + l.taxAmount, 0) };
}

/** India GSTR-3B style summary. Each document's tax per rate is split CGST/SGST vs IGST by place of supply. */
export function gstReturn(pack: CountryPack, input: TaxReturnInput): GstReturn {
  const byCode = new Map<string, GstRateRow>();
  let nilRated = 0;
  let exempt = 0;
  for (const { d, sign } of signedDocs(input)) {
    const intra = isIntraState(d.placeOfSupply, input.orgRegion);
    const perCode = new Map<string, { label: string; rate: number; taxable: number; tax: number }>();
    for (const l of d.lines) {
      const opt = lineTaxOption(pack, l.taxCode, l.taxRate);
      if (opt.kind === "exempt") exempt += sign * l.amount;
      else if (opt.kind === "zero") nilRated += sign * l.amount;
      else {
        const g = perCode.get(opt.code) ?? { label: opt.label, rate: opt.rate, taxable: 0, tax: 0 };
        g.taxable += l.amount;
        g.tax += l.taxAmount;
        perCode.set(opt.code, g);
      }
    }
    for (const [code, g] of perCode) {
      const s = splitGst(g.tax, intra);
      const row = byCode.get(code) ?? { code, label: g.label, rate: g.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      row.taxable += sign * g.taxable;
      row.cgst += sign * s.cgst;
      row.sgst += sign * s.sgst;
      row.igst += sign * s.igst;
      byCode.set(code, row);
    }
  }
  const byRate = [...byCode.values()].sort((a, b) => b.rate - a.rate);
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => byRate.reduce((s, r) => s + r[k], 0);
  const outward = { taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), tax: 0 };
  outward.tax = outward.cgst + outward.sgst + outward.igst;
  // Rate rows mix intra- and inter-state supplies, so sum the inter-state taxable value separately.
  let interState = 0;
  for (const { d, sign } of signedDocs(input)) {
    if (isIntraState(d.placeOfSupply, input.orgRegion)) continue;
    for (const l of d.lines) if (lineTaxOption(pack, l.taxCode, l.taxRate).kind === "standard") interState += sign * l.amount;
  }
  const itc = inputTax(input.expenses);
  return {
    kind: "GST",
    byRate,
    outward,
    interState: { taxable: interState, igst: outward.igst },
    nilRated,
    exempt,
    creditNotes: creditTotals(input.creditNotes),
    itc,
    net: outward.tax - itc.tax,
  };
}

/** UAE VAT 201 style summary. Supplies are attributed to the place-of-supply emirate (falling back to the org's). */
export function vatReturn(pack: CountryPack, input: TaxReturnInput): VatReturn {
  const emirates = new Map<string, VatEmirateRow>(pack.regions.map((e) => [e, { emirate: e, taxable: 0, vat: 0 }]));
  let zeroRated = 0;
  let exempt = 0;
  for (const { d, sign } of signedDocs(input)) {
    const where = d.placeOfSupply && emirates.has(d.placeOfSupply) ? d.placeOfSupply : input.orgRegion && emirates.has(input.orgRegion) ? input.orgRegion : UNASSIGNED;
    for (const l of d.lines) {
      const opt = lineTaxOption(pack, l.taxCode, l.taxRate);
      if (opt.kind === "exempt") exempt += sign * l.amount;
      else if (opt.kind === "zero") zeroRated += sign * l.amount;
      else {
        const row = emirates.get(where) ?? { emirate: where, taxable: 0, vat: 0 };
        row.taxable += sign * l.amount;
        row.vat += sign * l.taxAmount;
        emirates.set(where, row);
      }
    }
  }
  const byEmirate = [...emirates.values()];
  const standard = { taxable: byEmirate.reduce((s, r) => s + r.taxable, 0), vat: byEmirate.reduce((s, r) => s + r.vat, 0) };
  const inp = inputTax(input.expenses);
  return {
    kind: "VAT",
    byEmirate,
    standard,
    zeroRated,
    exempt,
    creditNotes: creditTotals(input.creditNotes),
    totalSupplies: { taxable: standard.taxable + zeroRated + exempt, vat: standard.vat },
    expenses: { taxable: inp.taxable, vat: inp.tax },
    net: standard.vat - inp.tax,
  };
}

export function taxReturn(pack: CountryPack, input: TaxReturnInput): TaxReturn {
  return pack.tax.name === "GST" ? gstReturn(pack, input) : vatReturn(pack, input);
}

export type CorporateTaxEstimate = { profit: number; taxable: number; zeroBand: number; chargeable: number; rate: number; tax: number };

/** Corporate tax on accounting profit: 0% up to the threshold, `rate`% above. Losses give zero tax. */
export function corporateTaxEstimate(profit: number, ct: { rate: number; threshold: number }): CorporateTaxEstimate {
  const taxable = Math.max(0, profit);
  const chargeable = Math.max(0, taxable - ct.threshold);
  return { profit, taxable, zeroBand: Math.min(taxable, ct.threshold), chargeable, rate: ct.rate, tax: Math.round((chargeable * ct.rate) / 100) };
}
