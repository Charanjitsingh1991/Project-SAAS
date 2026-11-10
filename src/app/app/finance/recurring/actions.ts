"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { YMD } from "@/lib/finance-utils";
import { formObject, todayYmd } from "@/lib/format";
import { generateRecurringInvoice, runDueRecurring } from "@/lib/posting";
import { requireWorkspace } from "@/lib/tenancy";

const FIX = "Please fix the highlighted fields.";
const date = z.string().regex(YMD, "Pick a date.");
const guard = () => requireWorkspace({ module: "finance", feature: "recurringInvoices" });

const ScheduleSchema = z
  .object({
    templateInvoiceId: z.coerce.number().int().positive("Choose an invoice to repeat."),
    frequency: z.enum(["monthly", "quarterly", "yearly"], "Choose how often."),
    nextDate: date,
    endDate: date.optional(),
    autoSend: z.string().optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.nextDate, { path: ["endDate"], message: "End date must be after the next invoice date." });

/** Repeat an existing invoice (its customer, lines and payment terms) on a schedule. */
export async function createScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const parsed = ScheduleSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const v = parsed.data;
  const [inv] = await db
    .select({ id: schema.invoices.id, number: schema.invoices.number, status: schema.invoices.status })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, v.templateInvoiceId), eq(schema.invoices.orgId, ws.org.id)))
    .limit(1);
  if (!inv) return { errors: { templateInvoiceId: ["Invoice not found."] }, message: FIX };
  if (inv.status === "void") return { errors: { templateInvoiceId: ["A void invoice can't be repeated."] }, message: FIX };
  const [dup] = await db
    .select({ id: schema.recurringInvoices.id })
    .from(schema.recurringInvoices)
    .where(and(eq(schema.recurringInvoices.orgId, ws.org.id), eq(schema.recurringInvoices.templateInvoiceId, inv.id)))
    .limit(1);
  if (dup) return { errors: { templateInvoiceId: [`${inv.number} already has a recurring schedule.`] }, message: FIX };
  await db.insert(schema.recurringInvoices).values({
    orgId: ws.org.id,
    templateInvoiceId: inv.id,
    frequency: v.frequency,
    nextDate: v.nextDate,
    endDate: v.endDate ?? null,
    autoSend: v.autoSend === "on",
  });
  await logActivity(ctxOf(ws), { module: "finance", entityType: "invoice", entityId: inv.id, action: "recurring", summary: `Set ${inv.number} to repeat ${v.frequency}` });
  refresh();
  return { ok: true, message: `${inv.number} will repeat ${v.frequency} from ${v.nextDate}.` };
}

const IdSchema = z.object({ id: z.coerce.number().int().positive() });

async function scheduleOf(orgId: number, fd: FormData) {
  const p = IdSchema.safeParse(formObject(fd));
  if (!p.success) return null;
  const [r] = await db
    .select()
    .from(schema.recurringInvoices)
    .where(and(eq(schema.recurringInvoices.id, p.data.id), eq(schema.recurringInvoices.orgId, orgId)))
    .limit(1);
  return r ?? null;
}

/** Pause or resume. Resuming never back-fills missed cycles: a past next date moves to today. */
export async function toggleScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const r = await scheduleOf(ws.org.id, fd);
  if (!r) return { message: "Schedule not found." };
  const today = todayYmd();
  const patch = r.active ? { active: false } : { active: true, nextDate: r.nextDate < today ? today : r.nextDate };
  await db.update(schema.recurringInvoices).set(patch).where(eq(schema.recurringInvoices.id, r.id));
  refresh();
  return { ok: true, message: r.active ? "Schedule paused." : "Schedule resumed." };
}

export async function generateNowAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const r = await scheduleOf(ws.org.id, fd);
  if (!r) return { message: "Schedule not found." };
  if (!r.active) return { message: "Resume the schedule first." };
  const id = await generateRecurringInvoice(ctxOf(ws), r.id, { force: true });
  if (!id) return { message: "Nothing generated — the schedule has passed its end date and is now paused." };
  refresh();
  return { ok: true, message: "Invoice generated." };
}

export async function runDueAction(): Promise<FormState> {
  const ws = await guard();
  const made = await runDueRecurring(ctxOf(ws));
  refresh();
  return { ok: true, message: made ? `Generated ${made} invoice${made === 1 ? "" : "s"}.` : "No schedules are due today." };
}

export async function deleteScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await guard();
  const r = await scheduleOf(ws.org.id, fd);
  if (!r) return { message: "Schedule not found." };
  await db.delete(schema.recurringInvoices).where(eq(schema.recurringInvoices.id, r.id));
  await logActivity(ctxOf(ws), { module: "finance", entityType: "invoice", entityId: r.templateInvoiceId, action: "recurring_deleted", summary: "Deleted a recurring schedule" });
  refresh();
  return { ok: true, message: "Schedule deleted. Invoices already generated are kept." };
}
