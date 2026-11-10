/** Pure HRM helpers (no server-only imports) so they can be unit-tested. Dates are "YYYY-MM-DD". */
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "./accounting";
import { NATIONALITIES, type CountryPack } from "./countries";
import type { EmployeeFieldDef } from "./countries/types";
import { addDaysYmd } from "./format";
import { taxOf, toMinor } from "./money";

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidYmd(s: string | null | undefined): s is string {
  if (!s || !YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}
/** Saturday + Sunday; callers should pass the org's set from weekendOf(org). */
export const DEFAULT_WEEKEND: readonly number[] = [0, 6];

export function isWeekend(ymd: string, weekend: readonly number[] = DEFAULT_WEEKEND) {
  return weekend.includes(dayOfWeek(ymd));
}

/** Every date from start to end inclusive (capped at 800 days to bound loops). */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start, i = 0; d <= end && i < 800; d = addDaysYmd(d, 1), i++) out.push(d);
  return out;
}

/** Dates in the range that are neither weekends nor holidays. */
export function workingDates(start: string, end: string, holidays: ReadonlySet<string>, weekend: readonly number[] = DEFAULT_WEEKEND) {
  return eachDate(start, end).filter((d) => !isWeekend(d, weekend) && !holidays.has(d));
}

/** Leave days: working days only; a half-day request (single date) counts 0.5. */
export function countLeaveDays(start: string, end: string, halfDay: boolean, holidays: ReadonlySet<string>, weekend: readonly number[] = DEFAULT_WEEKEND) {
  if (end < start) return 0;
  const n = workingDates(start, end, holidays, weekend).length;
  if (halfDay) return start === end && n === 1 ? 0.5 : 0;
  return n;
}

export function leaveBalance(quota: number, approved: number, pending = 0) {
  return { quota, used: approved, pending, balance: quota - approved, available: quota - approved - pending };
}

export const monthOf = (ymd: string) => ymd.slice(0, 7);

export function monthRange(ym: string) {
  const start = `${ym}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = addDaysYmd(next.toISOString().slice(0, 10), -1);
  return { start, end, days: Number(end.slice(8)) };
}

export function shiftMonth(ym: string, n: number) {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

/** Monthly + annual salary structure from annual CTC (minor units): Basic 50%, HRA 40% of basic (50% metro), Special = rest. */
export function salaryStructure(annualCtc: number, metro: boolean) {
  const basic = Math.round(annualCtc * 0.5);
  const hra = Math.round(basic * (metro ? 0.5 : 0.4));
  const special = Math.max(0, annualCtc - basic - hra);
  const annual = { basic, hra, special, total: basic + hra + special };
  const monthly = {
    basic: Math.round(basic / 12),
    hra: Math.round(hra / 12),
    special: Math.round(special / 12),
    total: Math.round(annualCtc / 12),
  };
  return { annual, monthly };
}

export function maskPan(pan: string | null | undefined) {
  if (!pan) return "—";
  return pan.length <= 4 ? pan : `${"•".repeat(pan.length - 4)}${pan.slice(-4)}`;
}
export function maskAccount(acc: string | null | undefined) {
  if (!acc) return "—";
  return acc.length <= 4 ? acc : `${"•".repeat(Math.min(acc.length - 4, 8))}${acc.slice(-4)}`;
}

/** Mask for any sensitive identifier (Emirates ID, IBAN, PAN, account no.): last 4 visible. */
export const maskId = maskAccount;

/* ───── Country-specific employee fields ───── */

export type EmployeeFieldKey = EmployeeFieldDef["key"];

/**
 * Validates and normalises the country pack's employee fields from raw form values.
 * Blank → null (clears the column). Uppercase fields are upper-cased and stripped of spaces before matching.
 */
export function parseEmployeeFields(defs: readonly EmployeeFieldDef[], raw: Record<string, string | undefined>) {
  const values: Partial<Record<EmployeeFieldKey, string | null>> = {};
  const errors: Record<string, string[]> = {};
  for (const f of defs) {
    let v = raw[f.key]?.trim();
    if (!v) {
      values[f.key] = null;
      continue;
    }
    if (f.uppercase) v = v.toUpperCase().replace(/\s+/g, "");
    if (v.length > 64) errors[f.key] = [`${f.label} is too long.`];
    else if (f.type === "date" && !isValidYmd(v)) errors[f.key] = ["Enter a valid date."];
    else if (f.type === "country" && !NATIONALITIES.some((n) => n.code === v)) errors[f.key] = ["Pick a nationality from the list."];
    else if (f.pattern && !new RegExp(f.pattern).test(v)) errors[f.key] = [`${f.label} should look like ${f.patternHint ?? f.placeholder ?? "the expected format"}.`];
    values[f.key] = v;
  }
  return { values, errors };
}

export type ExpiryAlert = { key: EmployeeFieldKey; label: string; date: string; daysLeft: number; expired: boolean };

/** Document expiries (pack date fields named *Expiry) that have passed or fall within `withinDays` of today. */
export function expiryAlerts(
  defs: readonly EmployeeFieldDef[],
  emp: Partial<Record<EmployeeFieldKey, string | null>>,
  today: string,
  withinDays = 60,
): ExpiryAlert[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  const out: ExpiryAlert[] = [];
  for (const f of defs) {
    if (f.type !== "date" || !f.key.endsWith("Expiry")) continue;
    const d = emp[f.key];
    if (!d || !isValidYmd(d)) continue;
    const daysLeft = Math.round((Date.parse(`${d}T00:00:00Z`) - t) / 86_400_000);
    if (daysLeft <= withinDays) out.push({ key: f.key, label: f.label.replace(/ expiry$/i, ""), date: d, daysLeft, expired: daysLeft < 0 });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export function expiryText(a: ExpiryAlert) {
  if (a.expired) return `${a.label} expired ${-a.daysLeft}d ago`;
  return a.daysLeft === 0 ? `${a.label} expires today` : `${a.label} expires in ${a.daysLeft}d`;
}

/* ───── UAE salary components ───── */

export const UAE_COMPONENT_KEYS = ["basic", "housing", "transport", "other"] as const;
export type MonthlyComponents = Record<(typeof UAE_COMPONENT_KEYS)[number], number>;

/** employees.salaryComponents JSON → non-negative integer minor units per known key, or null. */
export function parseSalaryComponents(json: string | null | undefined): Partial<MonthlyComponents> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return null;
    const out: Partial<MonthlyComponents> = {};
    for (const k of UAE_COMPONENT_KEYS) if (Number.isInteger(v[k]) && v[k] >= 0) out[k] = v[k];
    return out;
  } catch {
    return null;
  }
}

/** Monthly components (minor units) → stored JSON + annual package (monthly total × 12). */
export function packageFromComponents(c: MonthlyComponents) {
  const monthly = UAE_COMPONENT_KEYS.reduce((s, k) => s + c[k], 0);
  return { json: monthly > 0 ? JSON.stringify(c) : null, monthly, annual: monthly * 12 };
}

/* ───── Expense claims ───── */

/** Claim amounts in minor units: tax on the pre-tax amount at `ratePercent`. */
export function claimTotals(amount: number, ratePercent: number) {
  const taxAmount = ratePercent > 0 ? taxOf(amount, ratePercent) : 0;
  return { amount, taxAmount, total: amount + taxAmount };
}

export type ClaimStatus = "submitted" | "approved" | "rejected" | "reimbursed";
export type ReimburseVia = "payroll" | "direct";

export const CLAIM_TONE: Record<ClaimStatus, "butter" | "sky" | "rose" | "mint"> = {
  submitted: "butter",
  approved: "sky",
  rejected: "rose",
  reimbursed: "mint",
};

export const claimCategoryLabel = (c: string) => EXPENSE_CATEGORY_LABEL[c] ?? c;

/** Tax options for a claim form: "none" plus the pack's non-exempt rates. */
export function claimTaxOptions(pack: CountryPack) {
  return [{ value: "none", label: "No tax on receipt" }, ...pack.tax.rates.filter((r) => r.kind !== "exempt").map((r) => ({ value: r.code, label: r.label }))];
}

export type ParsedClaim = { date: string; category: string; description: string; amount: number; taxAmount: number; total: number; reimburseVia: ReimburseVia };

/** Validates a claim form. "payroll" reimbursement is only honoured when the payroll module is available. */
export function parseClaim(
  raw: { date?: string; category?: string; description?: string; amount?: string; tax?: string; reimburseVia?: string },
  pack: CountryPack,
  payrollAvailable: boolean,
  today: string,
): { errors: Record<string, string[]> } | { claim: ParsedClaim } {
  const errors: Record<string, string[]> = {};
  if (!isValidYmd(raw.date)) errors.date = ["Enter the expense date."];
  else if (raw.date > today) errors.date = ["The expense date can't be in the future."];
  if (!EXPENSE_CATEGORIES.some((c) => c.value === raw.category)) errors.category = ["Pick a category."];
  const description = raw.description?.trim() ?? "";
  if (description.length < 3) errors.description = ["Describe the expense."];
  else if (description.length > 300) errors.description = ["Keep the description under 300 characters."];
  const amount = toMinor(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = ["Enter the amount before tax."];
  else if (amount > 1e10) errors.amount = ["That amount is too large."];
  const rate = !raw.tax || raw.tax === "none" ? 0 : pack.tax.rates.find((r) => r.code === raw.tax && r.kind !== "exempt")?.rate;
  if (rate === undefined) errors.tax = ["Pick a tax rate."];
  if (Object.keys(errors).length) return { errors };
  const reimburseVia: ReimburseVia = raw.reimburseVia === "payroll" && payrollAvailable ? "payroll" : "direct";
  return { claim: { date: raw.date!, category: raw.category!, description, reimburseVia, ...claimTotals(amount, rate ?? 0) } };
}

/** Attrition % = exits in the window ÷ average headcount (start & end of window). */
export function attritionPct(exits: number, headcountStart: number, headcountEnd: number) {
  const avg = (headcountStart + headcountEnd) / 2;
  return avg > 0 ? Math.round((exits / avg) * 1000) / 10 : 0;
}

type OrgNode<T> = T & { children: OrgNode<T>[] };

/** Builds a forest from manager links. Orphans (missing manager) and cycles become roots. */
export function buildOrgTree<T extends { id: number; managerId: number | null }>(rows: T[]): OrgNode<T>[] {
  const byId = new Map<number, OrgNode<T>>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: OrgNode<T>[] = [];
  for (const node of byId.values()) {
    let cyclic = false;
    for (let cur = node.managerId, i = 0; cur != null && i <= rows.length; i++) {
      if (cur === node.id) {
        cyclic = true;
        break;
      }
      cur = byId.get(cur)?.managerId ?? null;
    }
    const parent = node.managerId != null && !cyclic ? byId.get(node.managerId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export type AttRow = { date: string; status: string; unpaidLeaveDays?: number };

/** Totals for a register row. LOP = absent + half-days × 0.5 + unpaid leave days. */
export function summarizeAttendance(rows: AttRow[]) {
  const s = { present: 0, wfh: 0, absent: 0, half: 0, leave: 0, holiday: 0, lop: 0 };
  for (const r of rows) {
    if (r.status === "present") s.present++;
    else if (r.status === "wfh") s.wfh++;
    else if (r.status === "absent") {
      s.absent++;
      s.lop += 1;
    } else if (r.status === "half_day") {
      s.half++;
      s.lop += 0.5;
    } else if (r.status === "leave") {
      s.leave++;
      s.lop += r.unpaidLeaveDays ?? 0;
    } else if (r.status === "holiday") s.holiday++;
  }
  return s;
}

/** "HH:MM" for an instant in the given IANA timezone. */
export function hhmm(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export const ONBOARDING_TEMPLATE = [
  { title: "Send offer letter", offset: -7 },
  { title: "Collect ID, statutory & bank documents", offset: -3 },
  { title: "Create email & tool accounts", offset: -1 },
  { title: "Assign laptop & equipment", offset: 0 },
  { title: "Add to payroll", offset: 0 },
  { title: "Day-1 orientation", offset: 0 },
  { title: "30-day check-in with manager", offset: 30 },
];

export const OFFBOARDING_TEMPLATE = [
  { title: "Accept & acknowledge resignation", offset: -28 },
  { title: "Knowledge transfer & handover", offset: -14 },
  { title: "Return laptop & assets", offset: -2 },
  { title: "Revoke account & system access", offset: 0 },
  { title: "Exit interview", offset: -1 },
  { title: "Full & final settlement", offset: 7 },
  { title: "Issue relieving & experience letter", offset: 7 },
];

export const LEAVE_COLORS = ["mint", "butter", "sky", "peach", "lilac", "rose", "lime"] as const;
