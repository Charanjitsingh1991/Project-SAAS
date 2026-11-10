/**
 * Pure UAE payroll engine. All amounts in minor units (fils).
 * - No personal income tax.
 * - GPSSA pension for UAE nationals under Federal Decree-Law 57/2023 (first-time contributors from 31 Oct 2023):
 *   employee 11%; employer 12.5% (15% when the contribution salary is AED 20,000 or more; below that the
 *   government tops up 2.5%). Private-sector contribution salary is bounded AED 3,000–70,000.
 *   Abu Dhabi (ADPF) and other GCC nationals' schemes are not modelled.
 * - End-of-service gratuity (Decree-Law 33/2021, Art. 51) for non-nationals: 21 days' basic per year for the first
 *   5 years, 30 days per year after, capped at 2 years' wage; daily basic wage = monthly basic / 30.
 */
import type { DeductionLine, EarningLine, EmployerLine, PayslipBreakdown } from "./payroll-types";
import { sumLines } from "./payroll-types";

const AED = 100;
export const GPSSA = {
  employeeRate: 0.11,
  employerRate: 0.125,
  employerRateHigh: 0.15,
  highThreshold: 20_000 * AED,
  minSalary: 3_000 * AED,
  maxSalary: 70_000 * AED,
};

export type UaeComponents = { basic: number; housing: number; transport: number; other: number };

export type UaePayrollInput = {
  /** Full-month components (before proration). */
  components: UaeComponents;
  uaeNational: boolean;
  daysInMonth: number;
  paidDays: number;
  /** Completed service (days) at the end of the period, for gratuity tier selection. */
  serviceDaysAtPeriodEnd: number;
  /** Days employed in this period (for gratuity accrual proration). */
  employedDays: number;
  bonus?: number;
  otherEarnings?: number;
  reimbursements?: number;
  loanDeduction?: number;
  otherDeductions?: number;
};

export type UaePayrollResult = {
  breakdown: PayslipBreakdown;
  basic: number;
  housing: number;
  transport: number;
  other: number;
  gross: number;
  pensionEmployee: number;
  pensionEmployer: number;
  gratuityAccrual: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
};

/** Monthly components from an annual package using the default split, or an explicit monthly override. */
export function uaeComponents(annualPackage: number, override: Partial<UaeComponents> | null, split: Record<string, number>): UaeComponents {
  if (override && Object.values(override).some((v) => (v ?? 0) > 0)) {
    return { basic: override.basic ?? 0, housing: override.housing ?? 0, transport: override.transport ?? 0, other: override.other ?? 0 };
  }
  const monthly = annualPackage / 12;
  const basic = Math.round(monthly * (split.basic ?? 0.6));
  const housing = Math.round(monthly * (split.housing ?? 0.25));
  const transport = Math.round(monthly * (split.transport ?? 0.1));
  return { basic, housing, transport, other: Math.round(monthly) - basic - housing - transport };
}

export function gpssaContribution(contractSalary: number) {
  if (contractSalary <= 0) return { base: 0, employee: 0, employer: 0 };
  const base = Math.min(Math.max(contractSalary, GPSSA.minSalary), GPSSA.maxSalary);
  const employerRate = base >= GPSSA.highThreshold ? GPSSA.employerRateHigh : GPSSA.employerRate;
  return { base, employee: Math.round(base * GPSSA.employeeRate), employer: Math.round(base * employerRate) };
}

/** Gratuity days earned per year of service at a given service length. */
export function uaeGratuityDaysPerYear(serviceDays: number) {
  return serviceDays >= 5 * 365 ? 30 : 21;
}

/** Monthly provision so the liability tracks Art. 51 entitlement. */
export function uaeMonthlyGratuityAccrual(basicMonthly: number, serviceDaysAtPeriodEnd: number, employedDays: number, daysInMonth: number) {
  if (basicMonthly <= 0 || employedDays <= 0) return 0;
  const daily = basicMonthly / 30;
  const perYear = daily * uaeGratuityDaysPerYear(serviceDaysAtPeriodEnd);
  return Math.round((perYear / 12) * (employedDays / daysInMonth));
}

/** Art. 51 entitlement at exit. Nothing below one year of continuous service. */
export function uaeGratuity(basicMonthly: number, serviceDays: number) {
  if (serviceDays < 365 || basicMonthly <= 0) return { amount: 0, note: "No gratuity: less than one year of service." };
  const years = serviceDays / 365;
  const daily = basicMonthly / 30;
  const first = Math.min(years, 5) * 21 * daily;
  const rest = Math.max(years - 5, 0) * 30 * daily;
  const cap = basicMonthly * 24;
  const raw = first + rest;
  const amount = Math.round(Math.min(raw, cap));
  return {
    amount,
    note: `${years.toFixed(2)} years: 21 days × ${Math.min(years, 5).toFixed(2)} yrs${years > 5 ? ` + 30 days × ${(years - 5).toFixed(2)} yrs` : ""} at basic/30${raw > cap ? " (capped at 2 years' basic)" : ""}.`,
  };
}

export function computeUaePayroll(i: UaePayrollInput): UaePayrollResult {
  const ratio = i.daysInMonth > 0 ? Math.min(Math.max(i.paidDays, 0), i.daysInMonth) / i.daysInMonth : 0;
  const c = i.components;
  const basic = Math.round(c.basic * ratio);
  const housing = Math.round(c.housing * ratio);
  const transport = Math.round(c.transport * ratio);
  const other = Math.round(c.other * ratio);
  const bonus = i.bonus ?? 0;
  const otherEarnings = i.otherEarnings ?? 0;
  const reimbursements = i.reimbursements ?? 0;

  const earnings: EarningLine[] = [
    { code: "basic", label: "Basic salary", amount: basic },
    { code: "housing", label: "Housing allowance", amount: housing },
    { code: "transport", label: "Transport allowance", amount: transport },
    { code: "other", label: "Other allowances", amount: other },
    { code: "bonus", label: "Bonus", amount: bonus },
    { code: "other_earnings", label: "Other earnings / overtime", amount: otherEarnings },
    { code: "reimbursement", label: "Expense reimbursements", amount: reimbursements },
  ].filter((l) => l.amount);
  const gross = basic + housing + transport + other + bonus + otherEarnings;

  // Contribution salary = full contract salary (not prorated for unpaid days).
  const pension = i.uaeNational ? gpssaContribution(c.basic + c.housing + c.transport + c.other) : { base: 0, employee: 0, employer: 0 };
  const gratuityAccrual = i.uaeNational ? 0 : uaeMonthlyGratuityAccrual(c.basic, i.serviceDaysAtPeriodEnd, i.employedDays, i.daysInMonth);

  const deductions: DeductionLine[] = [
    { code: "pension", label: "GPSSA pension (11%)", amount: pension.employee, account: "pension_payable" },
    { code: "loan", label: "Loan / advance recovery", amount: i.loanDeduction ?? 0, account: "advances" },
    { code: "other", label: "Other deductions", amount: i.otherDeductions ?? 0, account: "other_income" },
  ].filter((l) => l.amount);
  const employer: EmployerLine[] = [
    {
      code: "pension_employer",
      label: `Employer GPSSA (${pension.base >= GPSSA.highThreshold ? "15" : "12.5"}%)`,
      amount: pension.employer,
      expenseAccount: "employer_contrib",
      liabilityAccount: "pension_payable",
    },
    { code: "gratuity", label: "End-of-service gratuity accrual", amount: gratuityAccrual, expenseAccount: "gratuity_expense", liabilityAccount: "gratuity_provision" },
  ].filter((l) => l.amount);

  const totalDeductions = sumLines(deductions);
  const notes = [
    "No personal income tax in the UAE.",
    i.uaeNational
      ? `GPSSA on contribution salary ${(pension.base / AED).toLocaleString("en-AE")} AED (bounded 3,000–70,000).`
      : `Gratuity accrues at ${uaeGratuityDaysPerYear(i.serviceDaysAtPeriodEnd)} days' basic per year of service.`,
  ];
  return {
    breakdown: { earnings, deductions, employer, notes },
    basic,
    housing,
    transport,
    other,
    gross,
    pensionEmployee: pension.employee,
    pensionEmployer: pension.employer,
    gratuityAccrual,
    totalDeductions,
    net: gross + reimbursements - totalDeductions,
    employerCost: gross + pension.employer + gratuityAccrual,
  };
}
