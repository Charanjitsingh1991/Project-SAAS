import "server-only";
import { and, eq, gte, inArray, isNull, lte, or, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "@/lib/activity";
import { packOf } from "@/lib/countries";
import { daysBetween, formatPeriod } from "@/lib/format";
import { computeIndiaPayslip, daysInPeriod, lopAndPaidDays, type AttendanceInput } from "@/lib/payroll";
import { computeUaePayroll, uaeComponents, type UaeComponents } from "@/lib/payroll-ae";
import { markPayrollPaid } from "@/lib/posting";

type Employee = typeof schema.employees.$inferSelect;
type Org = typeof schema.organizations.$inferSelect;
type Adjustments = { bonus: number; otherEarnings: number; otherDeductions: number; note: string | null };
/** Approved payroll-route claims and loan installments due for an employee this period. */
type Extras = { reimbursements: number; claimIds: number[]; loanDeduction: number };

const NO_ADJ: Adjustments = { bonus: 0, otherEarnings: 0, otherDeductions: 0, note: null };
const NO_EXTRAS: Extras = { reimbursements: 0, claimIds: [], loanDeduction: 0 };

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const lastDay = (period: string) => `${period}-${String(daysInPeriod(period)).padStart(2, "0")}`;

async function getOrg(orgId: number): Promise<Org> {
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  return o;
}

async function getRun(ctx: Ctx, runId: number) {
  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ctx.orgId)))
    .limit(1);
  return run ?? null;
}

async function eligibleEmployees(orgId: number, period: string) {
  const first = `${period}-01`;
  const last = lastDay(period);
  return db
    .select({ e: schema.employees, dept: schema.departments.name })
    .from(schema.employees)
    .leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
    .where(
      and(
        eq(schema.employees.orgId, orgId),
        lte(schema.employees.joinDate, last),
        or(isNull(schema.employees.exitDate), gte(schema.employees.exitDate, first)),
        gt(schema.employees.annualCtc, 0),
      ),
    )
    .orderBy(schema.employees.code);
}

async function attendanceByEmployee(orgId: number, period: string, employeeIds: number[]) {
  const map = new Map<number, AttendanceInput[]>();
  if (!employeeIds.length) return map;
  const rows = await db
    .select({
      employeeId: schema.attendance.employeeId,
      date: schema.attendance.date,
      status: schema.attendance.status,
      leaveRequestId: schema.attendance.leaveRequestId,
      paid: schema.leaveTypes.paid,
      payPercent: schema.leaveTypes.payPercent,
      halfDay: schema.leaveRequests.halfDay,
    })
    .from(schema.attendance)
    .leftJoin(schema.leaveRequests, eq(schema.attendance.leaveRequestId, schema.leaveRequests.id))
    .leftJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
    .where(
      and(
        eq(schema.attendance.orgId, orgId),
        inArray(schema.attendance.employeeId, employeeIds),
        gte(schema.attendance.date, `${period}-01`),
        lte(schema.attendance.date, `${period}-31`),
      ),
    );
  for (const r of rows) {
    const list = map.get(r.employeeId) ?? [];
    const onLeave = r.status === "leave" && r.leaveRequestId != null;
    // Half-pay leave (e.g. UAE sick leave days 16–45) costs half a day per day.
    const halfPay = onLeave && r.paid !== false && r.payPercent != null && r.payPercent > 0 && r.payPercent < 100;
    list.push({
      date: r.date,
      status: r.status,
      unpaidLeave: onLeave && (r.paid === false || r.payPercent === 0 || halfPay),
      halfLeave: !!r.halfDay || halfPay,
    });
    map.set(r.employeeId, list);
  }
  return map;
}

/** Claims approved for payroll reimbursement (not yet on a payslip) and loan installments due. */
async function extrasByEmployee(orgId: number, period: string, employeeIds: number[]) {
  const map = new Map<number, Extras>();
  if (!employeeIds.length) return map;
  const get = (id: number) => map.get(id) ?? (map.set(id, { reimbursements: 0, claimIds: [], loanDeduction: 0 }), map.get(id)!);
  const claims = await db
    .select()
    .from(schema.expenseClaims)
    .where(
      and(
        eq(schema.expenseClaims.orgId, orgId),
        inArray(schema.expenseClaims.employeeId, employeeIds),
        eq(schema.expenseClaims.status, "approved"),
        eq(schema.expenseClaims.reimburseVia, "payroll"),
        isNull(schema.expenseClaims.payslipId),
        lte(schema.expenseClaims.date, lastDay(period)),
      ),
    );
  for (const c of claims) {
    const x = get(c.employeeId);
    x.reimbursements += c.total;
    x.claimIds.push(c.id);
  }
  const loans = await db
    .select()
    .from(schema.employeeLoans)
    .where(
      and(
        eq(schema.employeeLoans.orgId, orgId),
        inArray(schema.employeeLoans.employeeId, employeeIds),
        eq(schema.employeeLoans.status, "active"),
        lte(schema.employeeLoans.startPeriod, period),
      ),
    );
  for (const l of loans) get(l.employeeId).loanDeduction += Math.min(l.monthlyInstallment, l.balance);
  return map;
}

function parseComponents(json: string | null): Partial<UaeComponents> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Country-dispatched payslip column values (shared shape for India and UAE). */
export function slipValues(org: Org, e: Employee, dept: string | null, period: string, att: AttendanceInput[], adj: Adjustments, ex: Extras) {
  const pack = packOf(org);
  const days = lopAndPaidDays({ period, joinDate: e.joinDate, exitDate: e.exitDate, attendance: att });
  const base = {
    employeeId: e.id,
    employeeName: e.name,
    employeeCode: e.code,
    designation: e.designation,
    department: dept,
    paidDays: days.paidDays,
    lopDays: days.lopDays,
    bonus: adj.bonus,
    otherEarnings: adj.otherEarnings,
    otherDeductions: adj.otherDeductions,
    reimbursements: ex.reimbursements,
    loanDeduction: ex.loanDeduction,
    note: adj.note,
  };

  if (pack.payroll.engine === "AE") {
    const periodEnd = e.exitDate && e.exitDate < lastDay(period) ? e.exitDate : lastDay(period);
    const periodStart = e.joinDate > `${period}-01` ? e.joinDate : `${period}-01`;
    const r = computeUaePayroll({
      components: uaeComponents(e.annualCtc, parseComponents(e.salaryComponents), pack.payroll.defaultSplit),
      uaeNational: e.nationality === "AE",
      daysInMonth: days.daysInMonth,
      paidDays: days.paidDays,
      serviceDaysAtPeriodEnd: Math.max(0, daysBetween(e.joinDate, periodEnd) + 1),
      employedDays: Math.max(0, daysBetween(periodStart, periodEnd) + 1),
      bonus: adj.bonus,
      otherEarnings: adj.otherEarnings,
      otherDeductions: adj.otherDeductions,
      reimbursements: ex.reimbursements,
      loanDeduction: ex.loanDeduction,
    });
    return {
      ...base,
      basic: r.basic,
      hra: r.housing,
      transport: r.transport,
      special: r.other,
      gross: r.gross,
      pfEmployee: 0,
      esiEmployee: 0,
      professionalTax: 0,
      tds: 0,
      pfEmployer: 0,
      esiEmployer: 0,
      pensionEmployee: r.pensionEmployee,
      pensionEmployer: r.pensionEmployer,
      gratuityAccrual: r.gratuityAccrual,
      totalDeductions: r.totalDeductions,
      net: r.net,
      employerCost: r.employerCost,
      breakdown: JSON.stringify(r.breakdown),
    };
  }

  const b = computeIndiaPayslip({
    annualCtc: e.annualCtc,
    pfEnrolled: e.pfEnrolled,
    metro: e.metro,
    daysInMonth: days.daysInMonth,
    paidDays: days.paidDays,
    bonus: adj.bonus,
    otherEarnings: adj.otherEarnings,
    otherDeductions: adj.otherDeductions,
    reimbursements: ex.reimbursements,
    loanDeduction: ex.loanDeduction,
  });
  return {
    ...base,
    basic: b.basic,
    hra: b.hra,
    special: b.special,
    transport: 0,
    gross: b.gross,
    pfEmployee: b.pfEmployee,
    esiEmployee: b.esiEmployee,
    professionalTax: b.professionalTax,
    tds: b.tds,
    pfEmployer: b.pfEmployer,
    esiEmployer: b.esiEmployer,
    pensionEmployee: 0,
    pensionEmployer: 0,
    gratuityAccrual: 0,
    totalDeductions: b.totalDeductions,
    net: b.net,
    employerCost: b.employerCost,
    breakdown: JSON.stringify(b.breakdown),
  };
}

export async function recomputeRunTotals(ctx: Ctx, runId: number) {
  const slips = await db
    .select()
    .from(schema.payslips)
    .where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  const sum = (f: (p: (typeof slips)[number]) => number) => slips.reduce((s, p) => s + f(p), 0);
  await db
    .update(schema.payrollRuns)
    .set({
      employeeCount: slips.length,
      totalGross: sum((p) => p.gross),
      totalDeductions: sum((p) => p.totalDeductions),
      totalNet: sum((p) => p.net),
      totalEmployerCost: sum((p) => p.employerCost || p.gross + p.pfEmployer + p.esiEmployer),
    })
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ctx.orgId)));
}

/** Build and insert payslips for a run, linking the claims they reimburse. */
async function buildSlips(ctx: Ctx, runId: number, period: string, adjFor: (employeeId: number) => Adjustments) {
  const org = await getOrg(ctx.orgId);
  const emps = await eligibleEmployees(ctx.orgId, period);
  if (!emps.length) return 0;
  const ids = emps.map((x) => x.e.id);
  const att = await attendanceByEmployee(ctx.orgId, period, ids);
  const extras = await extrasByEmployee(ctx.orgId, period, ids);
  for (const x of emps) {
    const ex = extras.get(x.e.id) ?? NO_EXTRAS;
    const [slip] = await db
      .insert(schema.payslips)
      .values({ orgId: ctx.orgId, runId, ...slipValues(org, x.e, x.dept, period, att.get(x.e.id) ?? [], adjFor(x.e.id), ex) })
      .returning({ id: schema.payslips.id });
    if (ex.claimIds.length) {
      await db.update(schema.expenseClaims).set({ payslipId: slip.id }).where(inArray(schema.expenseClaims.id, ex.claimIds));
    }
  }
  return emps.length;
}

/** Release claims linked to a draft run's payslips so they can be picked up again. */
async function unlinkClaims(ctx: Ctx, runId: number) {
  const slips = await db.select({ id: schema.payslips.id }).from(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  if (!slips.length) return;
  await db
    .update(schema.expenseClaims)
    .set({ payslipId: null })
    .where(and(eq(schema.expenseClaims.orgId, ctx.orgId), inArray(schema.expenseClaims.payslipId, slips.map((s) => s.id))));
}

export async function createPayrollRun(ctx: Ctx, period: string): Promise<{ error: string } | { runId: number }> {
  if (!PERIOD_RE.test(period)) return { error: "Choose a valid month." };
  const [existing] = await db
    .select({ id: schema.payrollRuns.id })
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.orgId, ctx.orgId), eq(schema.payrollRuns.period, period)))
    .limit(1);
  if (existing) return { error: `A payroll run for ${formatPeriod(period)} already exists.` };

  const emps = await eligibleEmployees(ctx.orgId, period);
  if (!emps.length) return { error: `No employees are eligible for payroll in ${formatPeriod(period)}.` };

  const [run] = await db
    .insert(schema.payrollRuns)
    .values({ orgId: ctx.orgId, period, daysInMonth: daysInPeriod(period) })
    .returning({ id: schema.payrollRuns.id });
  const count = await buildSlips(ctx, run.id, period, () => NO_ADJ);
  await recomputeRunTotals(ctx, run.id);
  await logActivity(ctx, {
    module: "payroll",
    entityType: "payroll_run",
    entityId: run.id,
    action: "created",
    summary: `Created payroll run for ${formatPeriod(period)} (${count} employees)`,
  });
  return { runId: run.id };
}

/** Rebuild draft payslips from current employee/attendance/claims/loans data, keeping manual adjustments. */
export async function recalculateRun(ctx: Ctx, runId: number): Promise<string | null> {
  const run = await getRun(ctx, runId);
  if (!run) return "Payroll run not found.";
  if (run.status !== "draft") return "Only draft runs can be recalculated.";

  const old = await db.select().from(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  const adj = new Map(old.map((p) => [p.employeeId, { bonus: p.bonus, otherEarnings: p.otherEarnings, otherDeductions: p.otherDeductions, note: p.note }]));
  await unlinkClaims(ctx, runId);
  await db.delete(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  await buildSlips(ctx, runId, run.period, (id) => adj.get(id) ?? NO_ADJ);
  await recomputeRunTotals(ctx, runId);
  await logActivity(ctx, { module: "payroll", entityType: "payroll_run", entityId: runId, action: "recalculated", summary: `Recalculated payroll ${formatPeriod(run.period)}` });
  return null;
}

export async function adjustPayslip(ctx: Ctx, payslipId: number, adj: Adjustments): Promise<string | null> {
  const [slip] = await db
    .select()
    .from(schema.payslips)
    .where(and(eq(schema.payslips.id, payslipId), eq(schema.payslips.orgId, ctx.orgId)))
    .limit(1);
  if (!slip) return "Payslip not found.";
  const run = await getRun(ctx, slip.runId);
  if (!run) return "Payroll run not found.";
  if (run.status !== "draft") return "Only draft runs can be adjusted.";
  const [emp] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, slip.employeeId), eq(schema.employees.orgId, ctx.orgId)))
    .limit(1);
  if (!emp) return "Employee not found.";

  const org = await getOrg(ctx.orgId);
  const att = await attendanceByEmployee(ctx.orgId, run.period, [emp.id]);
  // Keep the claims and loan recovery already on this slip.
  const ex: Extras = { reimbursements: slip.reimbursements, claimIds: [], loanDeduction: slip.loanDeduction };
  const v = slipValues(org, emp, slip.department, run.period, att.get(emp.id) ?? [], adj, ex);
  await db.update(schema.payslips).set(v).where(eq(schema.payslips.id, slip.id));
  await recomputeRunTotals(ctx, run.id);
  await logActivity(ctx, {
    module: "payroll",
    entityType: "payslip",
    entityId: slip.id,
    action: "adjusted",
    summary: `Adjusted payslip of ${slip.employeeName} for ${formatPeriod(run.period)}`,
  });
  return null;
}

export async function approvePayrollRun(ctx: Ctx, runId: number): Promise<string | null> {
  const run = await getRun(ctx, runId);
  if (!run) return "Payroll run not found.";
  if (run.status !== "draft") return "Only draft runs can be approved.";
  if (run.employeeCount === 0) return "This run has no payslips.";
  await db
    .update(schema.payrollRuns)
    .set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date() })
    .where(eq(schema.payrollRuns.id, runId));
  await logActivity(ctx, { module: "payroll", entityType: "payroll_run", entityId: runId, action: "approved", summary: `Approved payroll ${formatPeriod(run.period)}` });
  return null;
}

export async function payPayrollRun(ctx: Ctx, runId: number, paymentDate: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return "Enter a valid payment date.";
  return markPayrollPaid(ctx, runId, paymentDate);
}

export async function deleteDraftRun(ctx: Ctx, runId: number): Promise<string | null> {
  const run = await getRun(ctx, runId);
  if (!run) return "Payroll run not found.";
  if (run.status !== "draft") return "Only draft runs can be deleted.";
  await unlinkClaims(ctx, runId);
  await db.delete(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  await db.delete(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId));
  await logActivity(ctx, { module: "payroll", entityType: "payroll_run", entityId: runId, action: "deleted", summary: `Deleted draft payroll ${formatPeriod(run.period)}` });
  return null;
}
