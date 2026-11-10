import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { packOf } from "@/lib/countries";
import { daysBetween } from "@/lib/format";
import { leaveBalances } from "@/lib/hrm-data";
import { computeSettlement, type SettlementBreakdown } from "@/lib/settlement";

type Employee = typeof schema.employees.$inferSelect;
type Org = { id: number; country?: string | null };

export async function activeLoanBalance(orgId: number, employeeId: number) {
  const rows = await db
    .select({ b: schema.employeeLoans.balance })
    .from(schema.employeeLoans)
    .where(and(eq(schema.employeeLoans.orgId, orgId), eq(schema.employeeLoans.employeeId, employeeId), eq(schema.employeeLoans.status, "active")));
  return rows.reduce((t, r) => t + r.b, 0);
}

/** Payslips for this employee in runs that are not yet paid (draft/approved). */
export async function openPayslips(orgId: number, employeeId: number) {
  return db
    .select({ period: schema.payrollRuns.period, status: schema.payrollRuns.status, runId: schema.payrollRuns.id })
    .from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(and(eq(schema.payslips.orgId, orgId), eq(schema.payslips.employeeId, employeeId), inArray(schema.payrollRuns.status, ["draft", "approved"])));
}

/** Editable defaults for a new settlement, with hints explaining each. */
export async function settlementSuggestions(org: Org, emp: Employee, exitDate: string) {
  const pack = packOf(org);
  const period = exitDate.slice(0, 7);
  const [slip] = await db
    .select({ id: schema.payslips.id })
    .from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(and(eq(schema.payslips.orgId, org.id), eq(schema.payslips.employeeId, emp.id), eq(schema.payrollRuns.period, period)))
    .limit(1);
  const monthStart = `${period}-01`;
  const from = emp.joinDate > monthStart ? emp.joinDate : monthStart;
  const unpaidDays = slip ? 0 : Math.max(0, daysBetween(from, exitDate) + 1);

  // Annual leave left this calendar year, accrued pro rata to the exit date.
  const year = Number(exitDate.slice(0, 4));
  const code = pack.code === "AE" ? "AL" : "EL";
  const bal = (await leaveBalances(org.id, emp.id, year)).find((b) => b.type.code === code);
  let leaveDays = 0;
  let leaveHint = `No ${code} leave type found — enter unused days manually.`;
  if (bal) {
    const yStart = `${year}-01-01`;
    const served = Math.max(0, daysBetween(emp.joinDate > yStart ? emp.joinDate : yStart, exitDate) + 1);
    const yearDays = daysBetween(yStart, `${year + 1}-01-01`);
    const accrued = (bal.quota * served) / yearDays;
    leaveDays = Math.max(0, Math.floor((accrued - bal.used) * 2) / 2);
    leaveHint = `${bal.type.name}: ${accrued.toFixed(1)} accrued in ${year} (of ${bal.quota}) − ${bal.used} taken. Carry-forward from earlier years is not included.`;
  }

  return {
    unpaidDays,
    unpaidHint: slip ? `A payroll run for ${period} already includes this employee.` : `Days worked in ${period} up to the exit date (not yet on a payslip).`,
    leaveDays,
    leaveHint,
    loanBalance: await activeLoanBalance(org.id, emp.id),
  };
}

export type SettlementFields = { exitDate: string; unpaidDays: number; leaveDays: number; otherEarnings: number; otherDeductions: number };

/** Calculate a settlement from current employee and loan data, shaped for finalSettlements. */
export async function buildSettlement(org: Org, emp: Employee, f: SettlementFields) {
  const pack = packOf(org);
  const r = computeSettlement({
    country: pack.code,
    joinDate: emp.joinDate,
    exitDate: f.exitDate,
    annualCtc: emp.annualCtc,
    salaryComponents: emp.salaryComponents,
    nationality: emp.nationality,
    defaultSplit: pack.payroll.defaultSplit,
    unpaidDays: f.unpaidDays,
    leaveDays: f.leaveDays,
    otherEarnings: f.otherEarnings,
    otherDeductions: f.otherDeductions,
    loanBalance: await activeLoanBalance(org.id, emp.id),
  });
  const breakdown: SettlementBreakdown = { lines: r.lines, notes: r.notes, inputs: { unpaidDays: f.unpaidDays, leaveDays: f.leaveDays } };
  return {
    result: r,
    row: {
      exitDate: f.exitDate,
      serviceDays: r.serviceDays,
      pendingSalary: r.pendingSalary,
      leaveEncashmentDays: r.leaveEncashmentDays,
      leaveEncashment: r.leaveEncashment,
      gratuity: r.gratuity,
      otherEarnings: r.otherEarnings,
      loanRecovery: r.loanRecovery,
      otherDeductions: r.otherDeductions,
      netPayable: r.netPayable,
      breakdown: JSON.stringify(breakdown),
    },
  };
}
