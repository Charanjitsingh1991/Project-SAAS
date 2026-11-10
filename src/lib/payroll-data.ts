import "server-only";
import { and, eq, gte, inArray, isNull, lte, or, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { logActivity, type Ctx } from "@/lib/activity";
import { formatPeriod } from "@/lib/format";
import { computePayroll, daysInPeriod, lopAndPaidDays, type AttendanceInput } from "@/lib/payroll";
import { markPayrollPaid } from "@/lib/posting";

type Employee = typeof schema.employees.$inferSelect;
type Adjustments = { bonus: number; otherEarnings: number; otherDeductions: number; note: string | null };

const NO_ADJ: Adjustments = { bonus: 0, otherEarnings: 0, otherDeductions: 0, note: null };

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
  const last = `${period}-${String(daysInPeriod(period)).padStart(2, "0")}`;
  const rows = await db
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
  return rows;
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
    list.push({
      date: r.date,
      status: r.status,
      unpaidLeave: r.status === "leave" && r.leaveRequestId != null && r.paid === false,
      halfLeave: !!r.halfDay,
    });
    map.set(r.employeeId, list);
  }
  return map;
}

function slipValues(
  e: Employee,
  dept: string | null,
  period: string,
  att: AttendanceInput[],
  adj: Adjustments,
) {
  const days = lopAndPaidDays({ period, joinDate: e.joinDate, exitDate: e.exitDate, attendance: att });
  const b = computePayroll({
    annualCtc: e.annualCtc,
    pfEnrolled: e.pfEnrolled,
    metro: e.metro,
    daysInMonth: days.daysInMonth,
    paidDays: days.paidDays,
    bonus: adj.bonus,
    otherEarnings: adj.otherEarnings,
    otherDeductions: adj.otherDeductions,
  });
  return {
    employeeId: e.id,
    employeeName: e.name,
    employeeCode: e.code,
    designation: e.designation,
    department: dept,
    paidDays: days.paidDays,
    lopDays: days.lopDays,
    basic: b.basic,
    hra: b.hra,
    special: b.special,
    bonus: b.bonus,
    otherEarnings: b.otherEarnings,
    gross: b.gross,
    pfEmployee: b.pfEmployee,
    esiEmployee: b.esiEmployee,
    professionalTax: b.professionalTax,
    tds: b.tds,
    otherDeductions: b.otherDeductions,
    totalDeductions: b.totalDeductions,
    net: b.net,
    pfEmployer: b.pfEmployer,
    esiEmployer: b.esiEmployer,
    note: adj.note,
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
      totalEmployerCost: sum((p) => p.gross + p.pfEmployer + p.esiEmployer),
    })
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ctx.orgId)));
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
  const att = await attendanceByEmployee(ctx.orgId, period, emps.map((x) => x.e.id));
  await db
    .insert(schema.payslips)
    .values(emps.map((x) => ({ orgId: ctx.orgId, runId: run.id, ...slipValues(x.e, x.dept, period, att.get(x.e.id) ?? [], NO_ADJ) })));
  await recomputeRunTotals(ctx, run.id);
  await logActivity(ctx, {
    module: "payroll",
    entityType: "payroll_run",
    entityId: run.id,
    action: "created",
    summary: `Created payroll run for ${formatPeriod(period)} (${emps.length} employees)`,
  });
  return { runId: run.id };
}

/** Rebuild draft payslips from current employee/attendance data, keeping manual adjustments. */
export async function recalculateRun(ctx: Ctx, runId: number): Promise<string | null> {
  const run = await getRun(ctx, runId);
  if (!run) return "Payroll run not found.";
  if (run.status !== "draft") return "Only draft runs can be recalculated.";

  const old = await db.select().from(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  const adj = new Map(
    old.map((p) => [p.employeeId, { bonus: p.bonus, otherEarnings: p.otherEarnings, otherDeductions: p.otherDeductions, note: p.note }]),
  );
  const emps = await eligibleEmployees(ctx.orgId, run.period);
  const att = await attendanceByEmployee(ctx.orgId, run.period, emps.map((x) => x.e.id));
  await db.delete(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  if (emps.length) {
    await db.insert(schema.payslips).values(
      emps.map((x) => ({
        orgId: ctx.orgId,
        runId,
        ...slipValues(x.e, x.dept, run.period, att.get(x.e.id) ?? [], adj.get(x.e.id) ?? NO_ADJ),
      })),
    );
  }
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

  const b = computePayroll({
    annualCtc: emp.annualCtc,
    pfEnrolled: emp.pfEnrolled,
    metro: emp.metro,
    daysInMonth: run.daysInMonth,
    paidDays: slip.paidDays,
    bonus: adj.bonus,
    otherEarnings: adj.otherEarnings,
    otherDeductions: adj.otherDeductions,
  });
  await db
    .update(schema.payslips)
    .set({
      basic: b.basic,
      hra: b.hra,
      special: b.special,
      bonus: b.bonus,
      otherEarnings: b.otherEarnings,
      gross: b.gross,
      pfEmployee: b.pfEmployee,
      esiEmployee: b.esiEmployee,
      professionalTax: b.professionalTax,
      tds: b.tds,
      otherDeductions: b.otherDeductions,
      totalDeductions: b.totalDeductions,
      net: b.net,
      pfEmployer: b.pfEmployer,
      esiEmployer: b.esiEmployer,
      note: adj.note,
    })
    .where(eq(schema.payslips.id, slip.id));
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
  await db.delete(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ctx.orgId)));
  await db.delete(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId));
  await logActivity(ctx, { module: "payroll", entityType: "payroll_run", entityId: runId, action: "deleted", summary: `Deleted draft payroll ${formatPeriod(run.period)}` });
  return null;
}
