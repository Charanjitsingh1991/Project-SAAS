"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { EXPENSE_CATEGORIES, GST_RATES, INDIAN_STATES } from "@/lib/accounting";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { YMD } from "@/lib/finance-utils";
import { formObject } from "@/lib/format";
import { postJournal } from "@/lib/ledger";
import { taxOf, toMinor } from "@/lib/money";
import {
  createDraftInvoice,
  createExpense,
  deleteExpense,
  deletePayment,
  payBill,
  recordPayment,
  saveInvoiceLines,
  sendInvoice,
  voidInvoice,
  type InvoiceLineInput,
} from "@/lib/posting";
import { requireWorkspace } from "@/lib/tenancy";

const FIX = "Please fix the highlighted fields.";
const date = z.string().regex(YMD, "Pick a date.");
const id = z.coerce.number().int().positive();
const methods = schema.PAYMENT_METHODS;

/* ───────────── Invoices ───────────── */

const LineSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1, "Every line needs a description."),
  quantity: z.number().gt(0, "Quantity must be more than 0."),
  unitPrice: z.number().min(0, "Price can't be negative."),
  taxRate: z.number().refine((r) => (GST_RATES as readonly number[]).includes(r), "Choose a valid GST rate."),
});

const InvoiceSchema = z
  .object({
    id: id.optional(),
    companyId: id.optional(),
    customerName: z.string().trim().min(2, "Enter a customer name.").max(120),
    customerEmail: z.email("Invalid email.").optional(),
    billingAddress: z.string().max(500).optional(),
    customerGstin: z.string().trim().toUpperCase().max(20).optional(),
    placeOfSupply: z.enum(INDIAN_STATES, "Choose the place of supply.").optional(),
    issueDate: date,
    dueDate: date,
    notes: z.string().max(1000).optional(),
    lines: z.string().min(2, "Add at least one line."),
  })
  .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "Due date must be on or after the issue date." });

export async function saveInvoice(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const ctx = ctxOf(ws);
  const parsed = InvoiceSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const v = parsed.data;

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(v.lines);
  } catch {
    return { errors: { lines: ["Invalid lines."] }, message: FIX };
  }
  const linesParsed = z.array(LineSchema).min(1, "Add at least one line.").safeParse(rawLines);
  if (!linesParsed.success) {
    const msg = linesParsed.error.issues[0]?.message ?? "Invalid lines.";
    return { errors: { lines: [msg] }, message: msg };
  }

  const productIds = [...new Set(linesParsed.data.map((l) => l.productId).filter((x): x is number => !!x))];
  if (productIds.length) {
    const owned = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.orgId, ws.org.id), inArray(schema.products.id, productIds)));
    if (owned.length !== productIds.length) return { errors: { lines: ["A selected product was not found."] }, message: FIX };
  }
  if (v.companyId) {
    const [c] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.id, v.companyId), eq(schema.companies.orgId, ws.org.id))).limit(1);
    if (!c) return { errors: { companyId: ["Customer not found."] }, message: FIX };
  }

  const lines: InvoiceLineInput[] = linesParsed.data.map((l) => ({
    productId: l.productId ?? null,
    description: l.description,
    quantity: l.quantity,
    unitPrice: toMinor(l.unitPrice),
    taxRate: l.taxRate,
  }));
  const header = {
    companyId: v.companyId ?? null,
    customerName: v.customerName,
    customerEmail: v.customerEmail ?? null,
    billingAddress: v.billingAddress ?? null,
    customerGstin: v.customerGstin ?? null,
    placeOfSupply: v.placeOfSupply ?? null,
    issueDate: v.issueDate,
    dueDate: v.dueDate,
    notes: v.notes ?? null,
  };

  let invoiceId: number;
  if (v.id) {
    const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, v.id), eq(schema.invoices.orgId, ws.org.id))).limit(1);
    if (!inv) return { message: "Invoice not found." };
    if (inv.status !== "draft") return { message: "Only draft invoices can be edited." };
    await db.update(schema.invoices).set(header).where(eq(schema.invoices.id, inv.id));
    await saveInvoiceLines(ctx, inv.id, lines);
    await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: inv.id, action: "updated", summary: `Updated draft invoice ${inv.number}` });
    invoiceId = inv.id;
  } else {
    const created = await createDraftInvoice(ctx, header, lines);
    await logActivity(ctx, { module: "finance", entityType: "invoice", entityId: created.id, action: "created", summary: `Created draft invoice ${created.number} for ${v.customerName}` });
    invoiceId = created.id;
  }
  redirect(`/app/finance/invoices/${invoiceId}`);
}

const InvoiceIdSchema = z.object({ invoiceId: id });

export async function sendInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = InvoiceIdSchema.safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid invoice." };
  const err = await sendInvoice(ctxOf(ws), p.data.invoiceId);
  if (err) return { message: err };
  refresh();
  return { ok: true, message: "Invoice sent and posted to the ledger." };
}

export async function voidInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = InvoiceIdSchema.safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid invoice." };
  const err = await voidInvoice(ctxOf(ws), p.data.invoiceId);
  if (err) return { message: err };
  refresh();
  return { ok: true, message: "Invoice voided." };
}

/** Draft invoices never touch the ledger, so they can be removed outright. */
export async function deleteDraftInvoice(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = InvoiceIdSchema.safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid invoice." };
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, p.data.invoiceId), eq(schema.invoices.orgId, ws.org.id))).limit(1);
  if (!inv) return { message: "Invoice not found." };
  if (inv.status !== "draft") return { message: "Only draft invoices can be deleted. Void it instead." };
  await db.update(schema.deals).set({ invoiceId: null }).where(and(eq(schema.deals.orgId, ws.org.id), eq(schema.deals.invoiceId, inv.id)));
  await db.update(schema.timeEntries).set({ invoiceId: null }).where(and(eq(schema.timeEntries.orgId, ws.org.id), eq(schema.timeEntries.invoiceId, inv.id)));
  await db.delete(schema.invoices).where(eq(schema.invoices.id, inv.id));
  await logActivity(ctxOf(ws), { module: "finance", entityType: "invoice", entityId: inv.id, action: "deleted", summary: `Deleted draft invoice ${inv.number}` });
  redirect("/app/finance/invoices");
}

const PaymentSchema = z.object({
  invoiceId: id,
  date,
  amount: z.string().min(1, "Enter an amount."),
  method: z.enum(methods, "Choose a method."),
  reference: z.string().max(80).optional(),
});

export async function recordPaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = PaymentSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const amount = toMinor(parsed.data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { errors: { amount: ["Enter a valid amount."] }, message: FIX };
  const err = await recordPayment(ctxOf(ws), parsed.data.invoiceId, {
    date: parsed.data.date,
    amount,
    method: parsed.data.method,
    reference: parsed.data.reference ?? null,
  });
  if (err) return { errors: { amount: [err] }, message: err };
  refresh();
  return { ok: true, message: "Payment recorded." };
}

export async function deletePaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = z.object({ paymentId: id }).safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid payment." };
  await deletePayment(ctxOf(ws), p.data.paymentId);
  refresh();
  return { ok: true, message: "Payment deleted." };
}

/* ───────────── Expenses ───────────── */

const ExpenseSchema = z
  .object({
    date,
    vendorId: id.optional(),
    description: z.string().trim().min(2, "Enter a description.").max(200),
    category: z.enum(EXPENSE_CATEGORIES.map((c) => c.value) as [string, ...string[]], "Choose a category."),
    amount: z.string().min(1, "Enter an amount."),
    gstRate: z.coerce.number().optional(),
    gstAmount: z.string().optional(),
    status: z.enum(["paid", "unpaid"]),
    dueDate: date.optional(),
    paymentMethod: z.enum(methods).optional(),
    reference: z.string().max(80).optional(),
  })
  .refine((v) => v.status === "paid" || !!v.dueDate, { path: ["dueDate"], message: "Add a due date for unpaid bills." });

export async function createExpenseAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = ExpenseSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const v = parsed.data;
  const amount = toMinor(v.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { errors: { amount: ["Must be greater than 0."] }, message: FIX };
  let tax = 0;
  if (v.gstAmount) {
    tax = toMinor(v.gstAmount);
    if (!Number.isFinite(tax) || tax < 0) return { errors: { gstAmount: ["Invalid GST amount."] }, message: FIX };
  } else if (v.gstRate) {
    if (!(GST_RATES as readonly number[]).includes(v.gstRate)) return { errors: { gstRate: ["Invalid GST rate."] }, message: FIX };
    tax = taxOf(amount, v.gstRate);
  }
  if (v.vendorId) {
    const [vendor] = await db.select({ id: schema.vendors.id }).from(schema.vendors).where(and(eq(schema.vendors.id, v.vendorId), eq(schema.vendors.orgId, ws.org.id))).limit(1);
    if (!vendor) return { errors: { vendorId: ["Vendor not found."] }, message: FIX };
  }
  const ctx = ctxOf(ws);
  const expenseId = await createExpense(ctx, {
    date: v.date,
    vendorId: v.vendorId ?? null,
    description: v.description,
    category: v.category,
    amount,
    taxAmount: tax,
    status: v.status,
    dueDate: v.status === "unpaid" ? (v.dueDate ?? null) : null,
    paymentMethod: v.status === "paid" ? (v.paymentMethod ?? "bank_transfer") : null,
    reference: v.reference ?? null,
    sourceType: "manual",
  });
  await logActivity(ctx, { module: "finance", entityType: "expense", entityId: expenseId, action: "created", summary: `Recorded ${v.status === "paid" ? "expense" : "bill"}: ${v.description}` });
  refresh();
  return { ok: true, message: v.status === "paid" ? "Expense recorded." : "Bill recorded." };
}

export async function payBillAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = z.object({ expenseId: id, date, method: z.enum(methods) }).safeParse(formObject(fd));
  if (!p.success) return { errors: z.flattenError(p.error).fieldErrors, message: FIX };
  const err = await payBill(ctxOf(ws), p.data.expenseId, p.data.date, p.data.method);
  if (err) return { message: err };
  refresh();
  return { ok: true, message: "Bill paid." };
}

export async function deleteExpenseAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = z.object({ expenseId: id }).safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid expense." };
  const err = await deleteExpense(ctxOf(ws), p.data.expenseId);
  if (err) return { message: err };
  refresh();
  return { ok: true, message: "Expense deleted." };
}

/* ───────────── Accounts & journal ───────────── */

const AccountSchema = z.object({
  code: z.string().trim().regex(/^\d{3,8}$/, "Use a numeric code (3–8 digits)."),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  type: z.enum(schema.ACCOUNT_TYPES, "Choose a type."),
});

export async function createAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = AccountSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  const [dup] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.orgId, ws.org.id), eq(schema.accounts.code, parsed.data.code))).limit(1);
  if (dup) return { errors: { code: ["This code is already used."] }, message: FIX };
  await db.insert(schema.accounts).values({ orgId: ws.org.id, ...parsed.data });
  await logActivity(ctxOf(ws), { module: "finance", entityType: "account", action: "created", summary: `Added account ${parsed.data.code} ${parsed.data.name}` });
  refresh();
  return { ok: true, message: "Account added." };
}

const JournalSchema = z.object({
  date,
  memo: z.string().trim().min(2, "Enter a memo.").max(200),
  lines: z.string().min(2, "Add at least two lines."),
});
const JournalLineSchema = z.object({
  accountId: z.number().int().positive("Pick an account for every line."),
  debit: z.number().min(0),
  credit: z.number().min(0),
});

export async function createJournalAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = JournalSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: FIX };
  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.lines);
  } catch {
    return { errors: { lines: ["Invalid lines."] }, message: FIX };
  }
  const lp = z.array(JournalLineSchema).min(2, "Add at least two lines.").safeParse(raw);
  if (!lp.success) {
    const msg = lp.error.issues[0]?.message ?? "Invalid lines.";
    return { errors: { lines: [msg] }, message: msg };
  }
  const lines = lp.data.map((l) => ({ accountId: l.accountId, debit: toMinor(l.debit), credit: toMinor(l.credit) }));
  if (lines.some((l) => (l.debit > 0) === (l.credit > 0))) {
    return { errors: { lines: ["Each line needs either a debit or a credit."] }, message: "Each line needs either a debit or a credit." };
  }
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (dr !== cr) return { errors: { lines: ["Debits and credits must be equal."] }, message: "Debits and credits must be equal." };

  const ids = [...new Set(lines.map((l) => l.accountId))];
  const owned = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.orgId, ws.org.id), inArray(schema.accounts.id, ids)));
  if (owned.length !== ids.length) return { errors: { lines: ["An account was not found."] }, message: FIX };

  const ctx = ctxOf(ws);
  try {
    await postJournal(ctx, { date: parsed.data.date, memo: parsed.data.memo, sourceType: "manual", lines });
  } catch (e) {
    return { message: e instanceof Error ? e.message : "Could not post the journal." };
  }
  await logActivity(ctx, { module: "finance", entityType: "journal", action: "posted", summary: `Posted manual journal: ${parsed.data.memo}` });
  refresh();
  return { ok: true, message: "Journal entry posted." };
}
