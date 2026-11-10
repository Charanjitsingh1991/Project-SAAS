/** Shared payroll breakdown contract between country engines, payslips and the ledger posting. */

export type EarningLine = {
  code: string; // basic, hra, housing, transport, special, other, bonus, other_earnings, reimbursement
  label: string;
  amount: number; // minor units
};

export type DeductionLine = {
  code: string; // pf, esi, pt, tds, pension, loan, other
  label: string;
  amount: number;
  /** Ledger system key credited when the run is paid (pf_payable, tds_payable, pt_payable, pension_payable, advances, other_income). */
  account: string;
};

export type EmployerLine = {
  code: string; // pf_employer, esi_employer, pension_employer, gratuity
  label: string;
  amount: number;
  expenseAccount: string; // employer_contrib, gratuity_expense
  liabilityAccount: string; // pf_payable, pension_payable, gratuity_provision
};

export type PayslipBreakdown = {
  earnings: EarningLine[];
  deductions: DeductionLine[];
  employer: EmployerLine[];
  /** Human-readable calculation notes shown on the payslip. */
  notes?: string[];
};

/** Earnings code for claim reimbursements (not salary: debits reimbursements payable, not salary expense). */
export const REIMBURSEMENT_CODE = "reimbursement";

export function parseBreakdown(json: string | null | undefined): PayslipBreakdown | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as PayslipBreakdown;
    return Array.isArray(v?.earnings) && Array.isArray(v?.deductions) && Array.isArray(v?.employer) ? v : null;
  } catch {
    return null;
  }
}

export function sumLines(lines: { amount: number }[]) {
  return lines.reduce((s, l) => s + l.amount, 0);
}
