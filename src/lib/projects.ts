import { addDaysYmd, daysBetween } from "./format";

export const WORK_HOURS_PER_YEAR = 2080;

/** Hourly cost (minor units) from annual CTC (minor units). */
export function hourlyCost(annualCtc: number) {
  return annualCtc > 0 ? annualCtc / WORK_HOURS_PER_YEAR : 0;
}

export type TimeLike = { hours: number; billable: boolean; costPerHour: number };

export type Profitability = {
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  burnPct: number | null;
  hours: number;
  billableHours: number;
};

/** Revenue: fixed = budget, hourly = billable hours × rate, non_billable = 0. Burn: cost/budget (fixed) or hours×rate/budget (hourly). */
export function profitability(p: { billingType: string; budget: number; hourlyRate: number }, entries: TimeLike[]): Profitability {
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0);
  const cost = Math.round(entries.reduce((s, e) => s + e.hours * e.costPerHour, 0));
  const revenue = p.billingType === "fixed" ? p.budget : p.billingType === "hourly" ? Math.round(billableHours * p.hourlyRate) : 0;
  const margin = revenue - cost;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : null;
  let burnPct: number | null = null;
  if (p.budget > 0) {
    if (p.billingType === "fixed") burnPct = (cost / p.budget) * 100;
    else if (p.billingType === "hourly") burnPct = ((hours * p.hourlyRate) / p.budget) * 100;
  }
  return { revenue, cost, margin, marginPct, burnPct, hours, billableHours };
}

export function progressPct(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export function isOverdue(due: string | null | undefined, status: string, today: string) {
  return !!due && status !== "done" && due < today;
}

/** Monday (YYYY-MM-DD) of the week containing ymd. */
export function weekStartOf(ymd: string) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

export function weekDays(monday: string) {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
}

export function isYmd(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Date range (padded by a day each side) covering the given dates, at least `minDays` wide. */
export function ganttRange(dates: (string | null | undefined)[], fallbackStart: string, minDays = 14) {
  const ds = dates.filter(isYmd).sort();
  const first = ds[0] ?? fallbackStart;
  let last = ds[ds.length - 1] ?? addDaysYmd(first, minDays);
  if (daysBetween(first, last) < minDays) last = addDaysYmd(first, minDays);
  const start = addDaysYmd(first, -1);
  const end = addDaysYmd(last, 1);
  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Left/width percentages of a bar spanning [from, to] (inclusive days) inside a range. */
export function ganttBar(from: string, to: string, range: { start: string; days: number }) {
  const a = Math.min(range.days - 1, Math.max(0, daysBetween(range.start, from)));
  const b = Math.min(range.days - 1, Math.max(a, daysBetween(range.start, to)));
  const span = b - a + 1;
  return { left: (a / range.days) * 100, width: (span / range.days) * 100 };
}

/** Centre-of-day position (%) of a date inside the range. */
export function ganttPos(ymd: string, range: { start: string; days: number }) {
  return ((daysBetween(range.start, ymd) + 0.5) / range.days) * 100;
}

export function fmtHours(h: number) {
  return `${Math.round(h * 100) / 100}h`;
}
