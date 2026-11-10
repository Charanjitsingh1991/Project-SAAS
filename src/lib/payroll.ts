/** Pure payroll calculation engine (India, new tax regime FY2025-26). All amounts in minor units (paise). */
import { REIMBURSEMENT_CODE, type PayslipBreakdown } from "./payroll-types";

const RUPEE = 100;
export const PF_WAGE_CAP = 15_000 * RUPEE;
export const ESI_GROSS_LIMIT = 21_000 * RUPEE;
export const PT_THRESHOLD = 15_000 * RUPEE;
export const PT_AMOUNT = 200 * RUPEE;
export const STANDARD_DEDUCTION = 75_000 * RUPEE;
export const REBATE_LIMIT = 12_00_000 * RUPEE;

/** [upper bound of slab (rupees), rate %] */
export const TAX_SLABS: readonly [number, number][] = [
  [4_00_000, 0],
  [8_00_000, 5],
  [12_00_000, 10],
  [16_00_000, 15],
  [20_00_000, 20],
  [24_00_000, 25],
  [Infinity, 30],
];

export type PayrollInput = {
  annualCtc: number;
  pfEnrolled: boolean;
  metro: boolean;
  daysInMonth: number;
  paidDays: number;
  bonus?: number;
  otherEarnings?: number;
  otherDeductions?: number;
};

export type PayrollBreakdown = {
  basic: number;
  hra: number;
  special: number;
  bonus: number;
  otherEarnings: number;
  gross: number;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
};

/** Annual tax (new regime) on annual gross, in paise, including 87A rebate and 4% cess. */
export function annualTax(annualGross: number): number {
  const taxable = Math.max(0, annualGross - STANDARD_DEDUCTION);
  if (taxable <= REBATE_LIMIT) return 0;
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of TAX_SLABS) {
    const top = upper * RUPEE;
    if (taxable > lower) tax += ((Math.min(taxable, top) - lower) * rate) / 100;
    lower = top;
  }
  return Math.round(tax * 1.04);
}

export function computePayroll(i: PayrollInput): PayrollBreakdown {
  const bonus = i.bonus ?? 0;
  const otherEarnings = i.otherEarnings ?? 0;
  const otherDeductions = i.otherDeductions ?? 0;
  const ratio = i.daysInMonth > 0 ? Math.min(Math.max(i.paidDays, 0), i.daysInMonth) / i.daysInMonth : 0;

  const monthly = i.annualCtc / 12;
  const fullBasic = monthly * 0.5;
  const fullHra = fullBasic * (i.metro ? 0.5 : 0.4);
  const fullSpecial = monthly - fullBasic - fullHra;
  const basic = Math.round(fullBasic * ratio);
  const hra = Math.round(fullHra * ratio);
  const special = Math.round(fullSpecial * ratio);

  const gross = basic + hra + special + bonus + otherEarnings;

  const pf = i.pfEnrolled ? Math.round(Math.min(basic, PF_WAGE_CAP) * 0.12) : 0;
  const esiApplies = gross > 0 && gross <= ESI_GROSS_LIMIT;
  const esiEmployee = esiApplies ? Math.round(gross * 0.0075) : 0;
  const esiEmployer = esiApplies ? Math.round(gross * 0.0325) : 0;
  const professionalTax = gross > PT_THRESHOLD ? PT_AMOUNT : 0;
  const tds = Math.round(annualTax(gross * 12) / 12);

  const totalDeductions = pf + esiEmployee + professionalTax + tds + otherDeductions;
  return {
    basic,
    hra,
    special,
    bonus,
    otherEarnings,
    gross,
    pfEmployee: pf,
    pfEmployer: pf,
    esiEmployee,
    esiEmployer,
    professionalTax,
    tds,
    otherDeductions,
    totalDeductions,
    net: gross - totalDeductions,
    employerCost: gross + pf + esiEmployer,
  };
}

export type AttendanceInput = {
  date: string;
  status: "present" | "absent" | "half_day" | "leave" | "holiday" | "wfh";
  /** Leave row whose leave type is unpaid. */
  unpaidLeave?: boolean;
  /** Unpaid leave covering only half the day. */
  halfLeave?: boolean;
};

export function daysInPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** LOP and paid days for a month. Days outside the employment window are unpaid but not LOP. */
export function lopAndPaidDays(args: {
  period: string;
  joinDate: string;
  exitDate?: string | null;
  attendance: AttendanceInput[];
}): { paidDays: number; lopDays: number; daysInMonth: number } {
  const { period, joinDate, exitDate, attendance } = args;
  const daysInMonth = daysInPeriod(period);
  const first = `${period}-01`;
  const last = `${period}-${String(daysInMonth).padStart(2, "0")}`;
  const start = joinDate > first ? joinDate : first;
  const end = exitDate && exitDate < last ? exitDate : last;
  const employed = start > end ? 0 : Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1;

  let lop = 0;
  for (const a of attendance) {
    if (a.date < start || a.date > end || !a.date.startsWith(period)) continue;
    if (a.status === "absent") lop += 1;
    else if (a.status === "half_day") lop += 0.5;
    else if (a.status === "leave" && a.unpaidLeave) lop += a.halfLeave ? 0.5 : 1;
  }
  lop = Math.min(lop, employed);
  return { paidDays: employed - lop, lopDays: lop, daysInMonth };
}

/** India result with the shared breakdown (claims and loan recoveries are outside gross/TDS). */
export function computeIndiaPayslip(i: PayrollInput & { reimbursements?: number; loanDeduction?: number }) {
  const b = computePayroll(i);
  const reimbursements = i.reimbursements ?? 0;
  const loanDeduction = i.loanDeduction ?? 0;
  const breakdown: PayslipBreakdown = {
    earnings: [
      { code: "basic", label: "Basic", amount: b.basic },
      { code: "hra", label: "HRA", amount: b.hra },
      { code: "special", label: "Special allowance", amount: b.special },
      { code: "bonus", label: "Bonus", amount: b.bonus },
      { code: "other_earnings", label: "Other earnings", amount: b.otherEarnings },
      { code: REIMBURSEMENT_CODE, label: "Expense reimbursements", amount: reimbursements },
    ].filter((l) => l.amount),
    deductions: [
      { code: "pf", label: "Provident fund (12%)", amount: b.pfEmployee, account: "pf_payable" },
      { code: "esi", label: "ESI (0.75%)", amount: b.esiEmployee, account: "pf_payable" },
      { code: "pt", label: "Professional tax", amount: b.professionalTax, account: "pt_payable" },
      { code: "tds", label: "Income tax (TDS)", amount: b.tds, account: "tds_payable" },
      { code: "loan", label: "Loan / advance recovery", amount: loanDeduction, account: "advances" },
      { code: "other", label: "Other deductions", amount: b.otherDeductions, account: "other_income" },
    ].filter((l) => l.amount),
    employer: [
      { code: "pf_employer", label: "Employer PF (12%)", amount: b.pfEmployer, expenseAccount: "employer_contrib", liabilityAccount: "pf_payable" },
      { code: "esi_employer", label: "Employer ESI (3.25%)", amount: b.esiEmployer, expenseAccount: "employer_contrib", liabilityAccount: "pf_payable" },
    ].filter((l) => l.amount),
    notes: ["TDS estimated under the new tax regime (FY 2025-26) on annualised gross."],
  };
  return {
    ...b,
    breakdown,
    reimbursements,
    loanDeduction,
    totalDeductions: b.totalDeductions + loanDeduction,
    net: b.net - loanDeduction + reimbursements,
  };
}

export const GRATUITY_CAP_IN = 20_00_000 * RUPEE;

/**
 * Payment of Gratuity Act: 15/26 × last monthly basic × completed years (a final part-year over 6 months counts as a year),
 * payable after 5 years of continuous service, capped at ₹20 lakh.
 */
export function indiaGratuity(basicMonthly: number, serviceDays: number) {
  const fullYears = Math.floor(serviceDays / 365);
  const remainderDays = serviceDays - fullYears * 365;
  const years = fullYears + (remainderDays > 182 ? 1 : 0);
  if (fullYears < 5 || basicMonthly <= 0) return { amount: 0, note: "No gratuity: less than 5 years of continuous service." };
  const raw = Math.round((basicMonthly * 15 * years) / 26);
  const amount = Math.min(raw, GRATUITY_CAP_IN);
  return { amount, note: `15/26 × basic × ${years} years${raw > amount ? " (capped at ₹20 lakh)" : ""}.` };
}
