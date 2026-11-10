/** Pure HRM helpers (no server-only imports) so they can be unit-tested. Dates are "YYYY-MM-DD". */
import { addDaysYmd } from "./format";

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
export function isWeekend(ymd: string) {
  const d = dayOfWeek(ymd);
  return d === 0 || d === 6;
}

/** Every date from start to end inclusive (capped at 800 days to bound loops). */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start, i = 0; d <= end && i < 800; d = addDaysYmd(d, 1), i++) out.push(d);
  return out;
}

/** Dates in the range that are neither weekends nor holidays. */
export function workingDates(start: string, end: string, holidays: ReadonlySet<string>) {
  return eachDate(start, end).filter((d) => !isWeekend(d) && !holidays.has(d));
}

/** Leave days: working days only; a half-day request (single date) counts 0.5. */
export function countLeaveDays(start: string, end: string, halfDay: boolean, holidays: ReadonlySet<string>) {
  if (end < start) return 0;
  const n = workingDates(start, end, holidays).length;
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
  { title: "Collect documents (ID, PAN, bank details)", offset: -3 },
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
