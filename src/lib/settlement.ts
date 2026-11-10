/**
 * Pure final-settlement (full & final) calculator. All amounts in minor units.
 * - Pending salary: monthly gross ÷ calendar days in the exit month × unpaid days worked (same proration as payroll).
 * - Leave encashment: UAE monthly basic ÷ 30 per day (Decree-Law 33/2021); India monthly basic ÷ 26 per day (common practice,
 *   mirroring the 26 working-day convention of the Gratuity Act).
 * - Gratuity: India Payment of Gratuity Act (indiaGratuity); UAE Art. 51 (uaeGratuity). UAE nationals get none (GPSSA pension).
 * - Loan recovery: outstanding balance of active loans/advances. A negative net means the employee owes the company.
 */
import { indiaGratuity } from "./payroll";
import { uaeComponents, uaeGratuity, type UaeComponents } from "./payroll-ae";

export type SettlementInput = {
  country: "IN" | "AE";
  joinDate: string;
  exitDate: string;
  annualCtc: number;
  /** employees.salaryComponents JSON (UAE monthly component override). */
  salaryComponents?: string | null;
  nationality?: string | null;
  /** Country pack payroll.defaultSplit (UAE). */
  defaultSplit?: Record<string, number>;
  /** Days worked in the exit month not yet paid through payroll. */
  unpaidDays: number;
  leaveDays: number;
  otherEarnings?: number;
  otherDeductions?: number;
  loanBalance?: number;
};

export type SettlementLine = { code: string; label: string; kind: "earning" | "deduction"; amount: number; note: string };

export type SettlementResult = {
  serviceDays: number;
  monthlyGross: number;
  monthlyBasic: number;
  daysInExitMonth: number;
  pendingSalary: number;
  leaveEncashmentDays: number;
  leaveEncashment: number;
  gratuity: number;
  otherEarnings: number;
  loanRecovery: number;
  otherDeductions: number;
  lines: SettlementLine[];
  totalEarnings: number;
  totalDeductions: number;
  /** Earnings − deductions; negative = recoverable from the employee. */
  netPayable: number;
  notes: string[];
};

/** JSON stored in finalSettlements.breakdown. */
export type SettlementBreakdown = { lines: SettlementLine[]; notes: string[]; inputs: { unpaidDays: number; leaveDays: number } };

const DAY = 86_400_000;

/** Inclusive calendar days from join to exit. */
export function serviceDaysBetween(joinDate: string, exitDate: string) {
  return Math.round((Date.parse(`${exitDate}T00:00:00Z`) - Date.parse(`${joinDate}T00:00:00Z`)) / DAY) + 1;
}

export function daysInMonthOf(ymd: string) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseComponents(json: string | null | undefined): Partial<UaeComponents> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Monthly gross and basic using the same rules as the payroll engines. */
export function monthlySalary(i: Pick<SettlementInput, "country" | "annualCtc" | "salaryComponents" | "defaultSplit">) {
  if (i.country === "AE") {
    const c = uaeComponents(i.annualCtc, parseComponents(i.salaryComponents), i.defaultSplit ?? {});
    return { gross: c.basic + c.housing + c.transport + c.other, basic: c.basic };
  }
  const gross = Math.round(i.annualCtc / 12);
  return { gross, basic: Math.round((i.annualCtc / 12) * 0.5) };
}

export function computeSettlement(i: SettlementInput): SettlementResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.exitDate) || !/^\d{4}-\d{2}-\d{2}$/.test(i.joinDate)) throw new Error("Invalid dates");
  const serviceDays = Math.max(0, serviceDaysBetween(i.joinDate, i.exitDate));
  const { gross, basic } = monthlySalary(i);
  const dim = daysInMonthOf(i.exitDate);
  const unpaidDays = Math.min(Math.max(i.unpaidDays, 0), dim);
  const leaveDays = Math.max(i.leaveDays, 0);
  const uae = i.country === "AE";
  const national = uae && i.nationality === "AE";

  const pendingSalary = Math.round((gross / dim) * unpaidDays);
  const leaveDivisor = uae ? 30 : 26;
  const leaveEncashment = Math.round((basic / leaveDivisor) * leaveDays);
  const g = national
    ? { amount: 0, note: "UAE national: no end-of-service gratuity — covered by GPSSA pension." }
    : uae
      ? uaeGratuity(basic, serviceDays)
      : indiaGratuity(basic, serviceDays);
  const otherEarnings = Math.max(i.otherEarnings ?? 0, 0);
  const loanRecovery = Math.max(i.loanBalance ?? 0, 0);
  const otherDeductions = Math.max(i.otherDeductions ?? 0, 0);

  const lines: SettlementLine[] = [
    { code: "salary", label: "Pending salary", kind: "earning", amount: pendingSalary, note: `Monthly gross ÷ ${dim} days × ${unpaidDays} unpaid day(s).` },
    {
      code: "leave",
      label: "Leave encashment",
      kind: "earning",
      amount: leaveEncashment,
      note: `Monthly basic ÷ ${leaveDivisor} × ${leaveDays} day(s)${uae ? "" : " (Indian practice: 26 working days a month)"}.`,
    },
    { code: "gratuity", label: uae ? "End-of-service gratuity" : "Gratuity", kind: "earning", amount: g.amount, note: g.note },
    { code: "other_earnings", label: "Other earnings", kind: "earning", amount: otherEarnings, note: "Bonus, notice pay or other dues entered manually." },
    { code: "loan", label: "Loan / advance recovery", kind: "deduction", amount: loanRecovery, note: "Outstanding balance of active loans and advances." },
    { code: "other_deductions", label: "Other deductions", kind: "deduction", amount: otherDeductions, note: "Notice shortfall, asset recovery or other amounts entered manually." },
  ];
  const totalEarnings = pendingSalary + leaveEncashment + g.amount + otherEarnings;
  const totalDeductions = loanRecovery + otherDeductions;
  const netPayable = totalEarnings - totalDeductions;

  const notes = [
    `Service ${serviceDays} day(s) (${(serviceDays / 365).toFixed(2)} years), joining and exit days inclusive.`,
    uae
      ? "UAE: gratuity under Federal Decree-Law 33/2021 Art. 51 on the last basic wage (daily wage = basic ÷ 30)."
      : "India: gratuity under the Payment of Gratuity Act, 1972 — 15/26 × last basic × completed years (part-year over 6 months rounds up), after 5 years, capped at ₹20 lakh.",
  ];
  if (netPayable < 0) notes.push("Deductions exceed dues: the net amount is recoverable from the employee.");

  return {
    serviceDays,
    monthlyGross: gross,
    monthlyBasic: basic,
    daysInExitMonth: dim,
    pendingSalary,
    leaveEncashmentDays: leaveDays,
    leaveEncashment,
    gratuity: g.amount,
    otherEarnings,
    loanRecovery,
    otherDeductions,
    lines,
    totalEarnings,
    totalDeductions,
    netPayable,
    notes,
  };
}

export function parseSettlementBreakdown(json: string | null | undefined): SettlementBreakdown | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && Array.isArray(v.lines) ? (v as SettlementBreakdown) : null;
  } catch {
    return null;
  }
}
