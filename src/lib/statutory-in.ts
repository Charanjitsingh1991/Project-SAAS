/**
 * India statutory file generators (pure): EPFO ECR 2.0 text, ESIC monthly contribution CSV and the
 * annual salary & TDS statement. All inputs are payslip figures in paise; files carry whole rupees.
 * These are aids for filing on the EPFO / ESIC portals, not filed returns.
 */
import { annualTax, PF_WAGE_CAP, STANDARD_DEDUCTION } from "./payroll";
import { sumLines, type PayslipBreakdown } from "./payroll-types";

const rupees = (paise: number) => Math.round(paise / 100);

export const ECR_SEPARATOR = "#~#";
export const EPS_RATE = 0.0833;
export const EPS_WAGE_CAP_RUPEES = PF_WAGE_CAP / 100;

export type StatutorySlip = {
  employeeId: number;
  code: string;
  name: string;
  gross: number;
  paidDays: number;
  lopDays: number;
  breakdown: PayslipBreakdown;
};

const sumCode = (lines: { code: string; amount: number }[], code: string) => sumLines(lines.filter((l) => l.code === code));

/** ECR member names allow letters and spaces only. */
export function ecrName(name: string) {
  return name.replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export type EcrInput = StatutorySlip & { uan: string | null };

export type EcrLine = { fields: string[]; text: string };

export function ecrLine(s: EcrInput): EcrLine {
  const basic = sumCode(s.breakdown.earnings, "basic");
  const epfWages = rupees(Math.min(basic, PF_WAGE_CAP));
  const epsWages = Math.min(epfWages, EPS_WAGE_CAP_RUPEES);
  const eps = Math.round(epsWages * EPS_RATE);
  const employeePf = rupees(sumCode(s.breakdown.deductions, "pf"));
  const employerPf = rupees(sumCode(s.breakdown.employer, "pf_employer"));
  const fields = [
    (s.uan ?? "").trim(),
    ecrName(s.name),
    rupees(s.gross),
    epfWages,
    epsWages,
    epfWages,
    employeePf,
    eps,
    Math.max(0, employerPf - eps),
    Math.round(s.lopDays),
    0,
  ].map(String);
  return { fields, text: fields.join(ECR_SEPARATOR) };
}

const isUan = (v: string | null) => /^\d{12}$/.test((v ?? "").trim());

/** Employees with a PF deduction go in the file; those without a valid 12-digit UAN are excluded and listed. */
export function buildEcr(slips: EcrInput[]) {
  const withPf = slips.filter((s) => sumCode(s.breakdown.deductions, "pf") > 0);
  const missingUan = withPf.filter((s) => !isUan(s.uan)).map((s) => ({ code: s.code, name: s.name }));
  const included = withPf.filter((s) => isUan(s.uan));
  return { content: included.map((s) => ecrLine(s).text).join("\n"), count: included.length, missingUan };
}

export type EsiInput = StatutorySlip & { ipNumber?: string | null; exitDate?: string | null };

export const ESI_HEADERS = ["IP Number", "IP Name", "No. of Days for which wages paid", "Total Monthly Wages", "Reason Code for Zero workings days(numeric only; provide 0 for no reason)", "Last Working Day"];

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ddmmyyyy = (ymd: string) => ymd.split("-").reverse().join("/");

/** Only employees with ESI deducted in the run. IP numbers aren't stored, so every row is flagged for the user to fill. */
export function buildEsi(slips: EsiInput[], period: string) {
  const eligible = slips.filter((s) => sumCode(s.breakdown.deductions, "esi") > 0);
  const rows = eligible.map((s) => {
    const left = s.exitDate && s.exitDate.startsWith(period) ? s.exitDate : null;
    const days = Math.round(s.paidDays);
    return [(s.ipNumber ?? "").trim(), s.name, days, rupees(s.gross), left ? 2 : days === 0 ? 1 : 0, left ? ddmmyyyy(left) : ""];
  });
  const missingIp = eligible.filter((s) => !(s.ipNumber ?? "").trim()).map((s) => ({ code: s.code, name: s.name }));
  const content = [ESI_HEADERS, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return { content, count: rows.length, missingIp };
}

/** FY label like 2026 → "2026–27"; the FY starts in April of the given year. */
export const fyLabel = (fy: number) => `${fy}–${String((fy + 1) % 100).padStart(2, "0")}`;
export const fyPeriods = (fy: number) => Array.from({ length: 12 }, (_, i) => (i < 9 ? `${fy}-${String(i + 4).padStart(2, "0")}` : `${fy + 1}-${String(i - 8).padStart(2, "0")}`));

/** Financial year (starting April) containing a YYYY-MM-DD date. */
export function fyOf(ymd: string) {
  const [y, m] = ymd.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

export type TaxStatementSlip = { period: string; gross: number; breakdown: PayslipBreakdown };

export type TaxStatement = {
  months: { period: string; gross: number; tds: number }[];
  components: { code: string; label: string; amount: number }[];
  gross: number;
  standardDeduction: number;
  professionalTax: number;
  taxableIncome: number;
  taxComputed: number;
  tdsDeducted: number;
  balance: number;
};

/** Annual statement over the paid runs of one FY, using the payroll engine's new-regime tax. Reimbursements aren't salary. */
export function buildTaxStatement(slips: TaxStatementSlip[]): TaxStatement {
  const sorted = [...slips].sort((a, b) => a.period.localeCompare(b.period));
  const comp = new Map<string, { code: string; label: string; amount: number }>();
  let professionalTax = 0;
  const months = sorted.map((s) => {
    for (const l of s.breakdown.earnings) {
      if (l.code === "reimbursement") continue;
      const c = comp.get(l.code) ?? { code: l.code, label: l.label, amount: 0 };
      c.amount += l.amount;
      comp.set(l.code, c);
    }
    professionalTax += sumCode(s.breakdown.deductions, "pt");
    return { period: s.period, gross: s.gross, tds: sumCode(s.breakdown.deductions, "tds") };
  });
  const gross = months.reduce((n, m) => n + m.gross, 0);
  const taxableIncome = Math.max(0, gross - STANDARD_DEDUCTION);
  const taxComputed = annualTax(gross);
  const tdsDeducted = months.reduce((n, m) => n + m.tds, 0);
  return {
    months,
    components: [...comp.values()],
    gross,
    standardDeduction: Math.min(gross, STANDARD_DEDUCTION),
    professionalTax,
    taxableIncome,
    taxComputed,
    tdsDeducted,
    balance: taxComputed - tdsDeducted,
  };
}
