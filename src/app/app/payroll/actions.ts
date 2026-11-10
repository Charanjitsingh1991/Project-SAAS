"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const PeriodSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month.") });

// PF 12%, professional tax 200 above 15,000, TDS 10% above 50,000.
function computePayslip(gross: number) {
  const deductions = Math.round(gross * 0.12) + (gross > 15000 ? 200 : 0) + (gross > 50000 ? Math.round(gross * 0.1) : 0);
  return { gross, deductions, net: gross - deductions };
}

export async function runPayroll(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "payroll" });
  const orgId = ws.org.id;
  const parsed = PeriodSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  const { period } = parsed.data;

  const [existing] = await db
    .select({ id: schema.payrollRuns.id })
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.orgId, orgId), eq(schema.payrollRuns.period, period)))
    .limit(1);
  if (existing) return { errors: { period: ["A run for this month already exists."] } };

  const emps = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.status, "active")));
  if (emps.length === 0) return { errors: { period: ["No active employees to pay."] } };

  const slips = emps.map((e) => ({ e, ...computePayslip(e.monthlySalary) }));
  let runId: number;
  try {
    const [run] = await db
      .insert(schema.payrollRuns)
      .values({
        orgId,
        period,
        employeeCount: slips.length,
        totalGross: slips.reduce((s, p) => s + p.gross, 0),
        totalDeductions: slips.reduce((s, p) => s + p.deductions, 0),
        totalNet: slips.reduce((s, p) => s + p.net, 0),
        status: "draft",
      })
      .returning({ id: schema.payrollRuns.id });
    runId = run.id;
  } catch {
    return { errors: { period: ["A run for this month already exists."] } };
  }
  await db.insert(schema.payslips).values(
    slips.map((p) => ({
      orgId,
      runId,
      employeeId: p.e.id,
      employeeName: p.e.name,
      gross: p.gross,
      deductions: p.deductions,
      net: p.net,
    })),
  );
  redirect(`/app/payroll/${runId}`);
}

export async function markRunPaid(fd: FormData) {
  const ws = await requireWorkspace({ module: "payroll" });
  await db
    .update(schema.payrollRuns)
    .set({ status: "paid" })
    .where(and(eq(schema.payrollRuns.id, Number(fd.get("id"))), eq(schema.payrollRuns.orgId, ws.org.id)));
  refresh();
}

export async function deleteRun(fd: FormData) {
  const ws = await requireWorkspace({ module: "payroll" });
  const runId = Number(fd.get("id"));
  const [run] = await db
    .select({ id: schema.payrollRuns.id })
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ws.org.id), eq(schema.payrollRuns.status, "draft")))
    .limit(1);
  if (run) {
    await db.delete(schema.payslips).where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.orgId, ws.org.id)));
    await db.delete(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.orgId, ws.org.id)));
  }
  redirect("/app/payroll");
}
