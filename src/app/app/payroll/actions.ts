"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/lib/definitions";
import { formObject, toMinor } from "@/lib/format";
import {
  adjustPayslip,
  approvePayrollRun,
  createPayrollRun,
  deleteDraftRun,
  payPayrollRun,
  PERIOD_RE,
  recalculateRun,
} from "@/lib/payroll-data";
import { ctxOf } from "@/lib/activity";
import { requireWorkspace } from "@/lib/tenancy";

const Id = z.coerce.number().int().positive();

export async function createRun(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "payroll" });
  const parsed = z.object({ period: z.string().regex(PERIOD_RE, "Choose a valid month.") }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const res = await createPayrollRun(ctxOf(ws), parsed.data.period);
  if ("error" in res) return { errors: { period: [res.error] } };
  refresh();
  redirect(`/app/payroll/${res.runId}`);
}

export async function approveRun(fd: FormData) {
  const ws = await requireWorkspace({ module: "payroll" });
  await approvePayrollRun(ctxOf(ws), Id.parse(fd.get("id")));
  refresh();
}

export async function recalcRun(fd: FormData) {
  const ws = await requireWorkspace({ module: "payroll" });
  await recalculateRun(ctxOf(ws), Id.parse(fd.get("id")));
  refresh();
}

export async function deleteRun(fd: FormData) {
  const ws = await requireWorkspace({ module: "payroll" });
  const err = await deleteDraftRun(ctxOf(ws), Id.parse(fd.get("id")));
  if (err) return;
  refresh();
  redirect("/app/payroll");
}

export async function markPaid(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "payroll" });
  const parsed = z
    .object({ id: Id, paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a payment date.") })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const err = await payPayrollRun(ctxOf(ws), parsed.data.id, parsed.data.paymentDate);
  if (err) return { message: err };
  refresh();
  return { ok: true, message: "Payroll marked as paid and posted to the ledger." };
}

const amount = z
  .string()
  .optional()
  .transform((v) => toMinor(v))
  .refine((v) => Number.isFinite(v) && v >= 0, "Enter a valid amount.");

export async function adjustSlip(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "payroll" });
  const parsed = z
    .object({ id: Id, bonus: amount, otherEarnings: amount, otherDeductions: amount, note: z.string().max(300).optional() })
    .safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { id, note, ...rest } = parsed.data;
  const err = await adjustPayslip(ctxOf(ws), id, { ...rest, note: note ?? null });
  if (err) return { message: err };
  refresh();
  return { ok: true, message: "Payslip recalculated." };
}
