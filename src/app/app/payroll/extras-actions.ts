"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formatMoney, formObject, toMinor } from "@/lib/format";
import { ctxOf, logActivity } from "@/lib/activity";
import { disburseLoan, paySettlement } from "@/lib/posting";
import { requireWorkspace } from "@/lib/tenancy";
import { activeLoanBalance, buildSettlement, openPayslips } from "./settlements/data";

const Id = z.coerce.number().int().positive();
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const amount = (opts: { positive?: boolean } = {}) =>
  z
    .string()
    .optional()
    .transform((v) => toMinor(v))
    .refine((v) => Number.isFinite(v) && (opts.positive ? v > 0 : v >= 0), opts.positive ? "Enter an amount above zero." : "Enter a valid amount.");
const days = z.preprocess((v) => v ?? 0, z.coerce.number("Enter a number of days.").min(0, "Cannot be negative.").max(366, "Too many days."));

const guard = () => requireWorkspace({ module: "payroll", manage: true });

async function employeeOf(orgId: number, id: number) {
  const [e] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, orgId)))
    .limit(1);
  return e ?? null;
}

/* ───────────── Loans & advances ───────────── */

export async function createLoan(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const parsed = z
    .object({
      employeeId: Id,
      type: z.enum(["loan", "advance"]),
      principal: amount({ positive: true }),
      monthlyInstallment: amount({ positive: true }),
      disbursedOn: Ymd,
      startPeriod: z.string().regex(/^\d{4}-\d{2}$/, "Choose the first deduction month."),
      note: z.string().max(300).optional(),
    })
    .refine((v) => v.monthlyInstallment <= v.principal, { path: ["monthlyInstallment"], message: "Installment cannot exceed the principal." })
    .refine((v) => v.startPeriod >= v.disbursedOn.slice(0, 7), { path: ["startPeriod"], message: "First deduction cannot be before disbursement." })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;
  const emp = await employeeOf(ws.org.id, v.employeeId);
  if (!emp) return { errors: { employeeId: ["Choose an employee."] } };
  if (emp.status === "exited") return { errors: { employeeId: ["This employee has exited."] } };

  const [loan] = await db
    .insert(schema.employeeLoans)
    .values({ orgId: ws.org.id, employeeId: emp.id, type: v.type, principal: v.principal, monthlyInstallment: v.monthlyInstallment, balance: v.principal, disbursedOn: v.disbursedOn, startPeriod: v.startPeriod, note: v.note ?? null })
    .returning({ id: schema.employeeLoans.id });
  try {
    const err = await disburseLoan(ctxOf(ws), loan.id);
    if (err) throw new Error(err);
  } catch (e) {
    await db.delete(schema.employeeLoans).where(eq(schema.employeeLoans.id, loan.id));
    return { message: `Could not post the disbursement: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  refresh();
  return { ok: true, message: `${v.type === "loan" ? "Loan" : "Advance"} of ${formatMoney(v.principal, ws.org.currency)} disbursed to ${emp.name}.` };
}

export async function updateInstallment(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const parsed = z.object({ id: Id, monthlyInstallment: amount({ positive: true }) }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const [loan] = await db
    .select()
    .from(schema.employeeLoans)
    .where(and(eq(schema.employeeLoans.id, parsed.data.id), eq(schema.employeeLoans.orgId, ws.org.id)))
    .limit(1);
  if (!loan) return { message: "Loan not found." };
  if (loan.status !== "active") return { message: "Only active loans can be changed." };
  if (parsed.data.monthlyInstallment > loan.principal) return { errors: { monthlyInstallment: ["Installment cannot exceed the principal."] } };
  await db.update(schema.employeeLoans).set({ monthlyInstallment: parsed.data.monthlyInstallment }).where(eq(schema.employeeLoans.id, loan.id));
  await logActivity(ctxOf(ws), { module: "payroll", entityType: "loan", entityId: loan.id, action: "updated", summary: `Changed loan installment to ${formatMoney(parsed.data.monthlyInstallment, ws.org.currency)}` });
  refresh();
  return { ok: true, message: "Installment updated. Draft payroll runs pick it up on recalculation." };
}

export async function closeLoan(fd: FormData) {
  const ws = await guard();
  const id = Id.parse(fd.get("id"));
  const [loan] = await db
    .select()
    .from(schema.employeeLoans)
    .where(and(eq(schema.employeeLoans.id, id), eq(schema.employeeLoans.orgId, ws.org.id)))
    .limit(1);
  if (!loan || loan.status !== "active" || loan.balance !== 0) return;
  await db.update(schema.employeeLoans).set({ status: "closed" }).where(eq(schema.employeeLoans.id, id));
  await logActivity(ctxOf(ws), { module: "payroll", entityType: "loan", entityId: id, action: "closed", summary: "Closed a fully recovered loan" });
  refresh();
}

/* ───────────── Final settlements ───────────── */

const settlementFields = z.object({
  exitDate: Ymd,
  unpaidDays: days,
  leaveDays: days,
  otherEarnings: amount(),
  otherDeductions: amount(),
});

export async function saveSettlement(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const parsed = settlementFields.extend({ employeeId: Id }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { employeeId, ...f } = parsed.data;
  const emp = await employeeOf(ws.org.id, employeeId);
  if (!emp) return { message: "Employee not found." };
  if (f.exitDate < emp.joinDate) return { errors: { exitDate: ["Exit date is before the joining date."] } };

  const [existing] = await db.select().from(schema.finalSettlements).where(eq(schema.finalSettlements.employeeId, emp.id)).limit(1);
  if (existing?.status === "paid") return { message: "This settlement is already paid and locked." };
  const { row } = await buildSettlement(ws.org, emp, f);

  let id: number;
  if (existing) {
    await db.update(schema.finalSettlements).set(row).where(eq(schema.finalSettlements.id, existing.id));
    id = existing.id;
  } else {
    const [ins] = await db.insert(schema.finalSettlements).values({ orgId: ws.org.id, employeeId: emp.id, ...row }).returning({ id: schema.finalSettlements.id });
    id = ins.id;
  }
  await logActivity(ctxOf(ws), { module: "payroll", entityType: "settlement", entityId: id, action: existing ? "updated" : "created", summary: `${existing ? "Updated" : "Drafted"} final settlement for ${emp.name}` });
  refresh();
  if (!existing) redirect(`/app/payroll/settlements/${id}`);
  return { ok: true, message: "Settlement recalculated." };
}

export async function deleteSettlement(fd: FormData) {
  const ws = await guard();
  const id = Id.parse(fd.get("id"));
  const [s] = await db
    .select()
    .from(schema.finalSettlements)
    .where(and(eq(schema.finalSettlements.id, id), eq(schema.finalSettlements.orgId, ws.org.id)))
    .limit(1);
  if (!s || s.status !== "draft") return;
  await db.delete(schema.finalSettlements).where(eq(schema.finalSettlements.id, id));
  await logActivity(ctxOf(ws), { module: "payroll", entityType: "settlement", entityId: id, action: "deleted", summary: "Deleted a draft final settlement" });
  refresh();
  redirect("/app/payroll/settlements");
}

export async function paySettlementAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const parsed = z.object({ id: Id, date: Ymd }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const [s] = await db
    .select()
    .from(schema.finalSettlements)
    .where(and(eq(schema.finalSettlements.id, parsed.data.id), eq(schema.finalSettlements.orgId, ws.org.id)))
    .limit(1);
  if (!s) return { message: "Settlement not found." };
  if (s.status === "paid") return { message: "This settlement is already paid." };

  // Avoid double-paying salary or double-recovering loans through an unpaid payroll run.
  const open = await openPayslips(ws.org.id, s.employeeId);
  if (open.length) return { message: `Pay or remove this employee from the ${open[0].status} payroll run for ${open[0].period} first.` };
  if ((await activeLoanBalance(ws.org.id, s.employeeId)) !== s.loanRecovery) return { message: "Loan balances changed since this draft was saved — recalculate the settlement first." };

  let err: string | null;
  try {
    err = await paySettlement(ctxOf(ws), s.id, parsed.data.date);
  } catch (e) {
    err = e instanceof Error ? e.message : "Could not post the settlement.";
  }
  if (err) return { message: err };

  // Offboard in HR so later payroll runs exclude the employee.
  await db
    .update(schema.employees)
    .set({ exitDate: s.exitDate, status: s.exitDate <= parsed.data.date ? "exited" : "notice" })
    .where(and(eq(schema.employees.id, s.employeeId), eq(schema.employees.orgId, ws.org.id)));
  refresh();
  return { ok: true, message: "Settlement paid and posted to the ledger." };
}
