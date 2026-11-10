"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FormState } from "@/lib/definitions";
import { formObject } from "@/lib/format";
import { requireWorkspace } from "@/lib/tenancy";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

const InvoiceSchema = z
  .object({
    number: z.string().min(1, "Required.").max(40),
    customerName: z.string().min(2, "Enter a customer name."),
    customerEmail: z.email("Invalid email.").optional(),
    amount: z.coerce.number().int().positive("Must be greater than 0."),
    issueDate: date,
    dueDate: date,
  })
  .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "Due date must be on or after issue date." });

export async function createInvoice(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = InvoiceSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };

  const [dup] = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.orgId, ws.org.id), eq(schema.invoices.number, parsed.data.number)))
    .limit(1);
  if (dup) return { errors: { number: ["Invoice number already exists."] }, message: "Please fix the highlighted fields." };

  await db.insert(schema.invoices).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: `Invoice ${parsed.data.number} created.` };
}

export async function setInvoiceStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "finance" });
  const status = z.enum(["draft", "sent", "paid", "void"]).parse(fd.get("status"));
  await db
    .update(schema.invoices)
    .set({ status })
    .where(and(eq(schema.invoices.id, Number(fd.get("id"))), eq(schema.invoices.orgId, ws.org.id)));
  refresh();
}

const ExpenseSchema = z.object({
  description: z.string().min(2, "Enter a description."),
  category: z.enum(["Rent", "Salaries", "Software", "Travel", "Marketing", "Supplies", "Utilities", "Other"], "Choose a category."),
  amount: z.coerce.number().int().positive("Must be greater than 0."),
  date,
});

export async function createExpense(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const parsed = ExpenseSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, message: "Please fix the highlighted fields." };
  await db.insert(schema.expenses).values({ ...parsed.data, orgId: ws.org.id });
  refresh();
  return { ok: true, message: "Expense added." };
}

export async function deleteExpense(fd: FormData) {
  const ws = await requireWorkspace({ module: "finance" });
  const id = z.coerce.number().int().positive().parse(fd.get("id"));
  await db.delete(schema.expenses).where(and(eq(schema.expenses.id, id), eq(schema.expenses.orgId, ws.org.id)));
  refresh();
}
