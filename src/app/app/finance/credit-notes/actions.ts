"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { YMD } from "@/lib/finance-utils";
import { formObject } from "@/lib/format";
import { formatMoney, toMinor } from "@/lib/money";
import { issueCreditNote, refundCustomer } from "@/lib/posting";
import { requireWorkspace } from "@/lib/tenancy";

const FIX = "Please fix the highlighted fields.";
const date = z.string().regex(YMD, "Pick a date.");

const CreditNoteSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  date,
  reason: z.string().trim().min(2, "Give a reason.").max(200),
  restock: z.string().optional(),
});

/** Credit selected quantities of an invoice's lines (fields `qty_<invoiceLineId>`). */
export async function issueCreditNoteAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = CreditNoteSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const lines: { invoiceLineId: number; quantity: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = /^qty_(\d+)$/.exec(k);
    if (!m || typeof v !== "string" || !v.trim()) continue;
    const quantity = Number(v);
    if (!Number.isFinite(quantity) || quantity < 0) return { errors: { lines: ["Quantities must be zero or more."] }, message: "Quantities must be zero or more." };
    if (quantity > 0) lines.push({ invoiceLineId: Number(m[1]), quantity });
  }
  if (!lines.length) return { errors: { lines: ["Enter a quantity to credit on at least one line."] }, message: "Enter a quantity to credit on at least one line." };
  const v = parsed.data;
  const res = await issueCreditNote(ctxOf(ws), v.invoiceId, { date: v.date, reason: v.reason, restock: v.restock === "on", lines });
  if ("error" in res) return { message: res.error };
  refresh();
  return { ok: true, message: `Credit note ${res.number} issued and posted to the ledger.` };
}

const RefundSchema = z.object({ invoiceId: z.coerce.number().int().positive(), date, amount: z.string().min(1, "Enter an amount.") });

export async function refundAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = RefundSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const amount = toMinor(parsed.data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { errors: { amount: ["Enter a valid amount."] }, message: FIX };
  const [inv] = await db
    .select({ issueDate: schema.invoices.issueDate, number: schema.invoices.number })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, parsed.data.invoiceId), eq(schema.invoices.orgId, ws.org.id)))
    .limit(1);
  if (!inv) return { message: "Invoice not found." };
  if (parsed.data.date < inv.issueDate) return { errors: { date: ["Refund date can't be before the invoice date."] }, message: FIX };
  const ctx = ctxOf(ws);
  const err = await refundCustomer(ctx, parsed.data.invoiceId, amount, parsed.data.date);
  if (err) return { errors: { amount: [err] }, message: err };
  await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: parsed.data.invoiceId, action: "refund", summary: `Refunded ${formatMoney(amount, ws.org.currency)} on ${inv.number}` });
  refresh();
  return { ok: true, message: "Refund recorded." };
}
