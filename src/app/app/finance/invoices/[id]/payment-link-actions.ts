"use server";

import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { sendEmail } from "@/lib/email";
import { formObject, formatMoney } from "@/lib/format";
import { paymentLinkMessage, paymentLinkReference } from "@/lib/razorpay";
import { cancelPaymentLink, createPaymentLink, getRazorpayConfig } from "@/lib/razorpay-api";
import { requireWorkspace } from "@/lib/tenancy";

const Input = z.object({ invoiceId: z.coerce.number().int().positive() });

async function load(orgId: number, invoiceId: number) {
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.orgId, orgId))).limit(1);
  const [link] = inv
    ? await db
        .select()
        .from(schema.invoicePaymentLinks)
        .where(and(eq(schema.invoicePaymentLinks.invoiceId, invoiceId), eq(schema.invoicePaymentLinks.orgId, orgId), eq(schema.invoicePaymentLinks.status, "created")))
        .orderBy(desc(schema.invoicePaymentLinks.id))
        .limit(1)
    : [];
  return { inv, link };
}

export async function createPaymentLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = Input.safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid invoice." };
  const cfg = await getRazorpayConfig(ws.org.id);
  if (!cfg) return { message: "Connect Razorpay under Integrations first." };
  const { inv, link: old } = await load(ws.org.id, p.data.invoiceId);
  if (!inv) return { message: "Invoice not found." };
  const balance = inv.total - inv.amountPaid - inv.amountCredited;
  if ((inv.status !== "sent" && inv.status !== "partial") || balance <= 0) return { message: "Only open invoices with a balance due can have a payment link." };

  let contact: string | undefined;
  if (inv.companyId) {
    const [c] = await db.select({ phone: schema.companies.phone }).from(schema.companies).where(and(eq(schema.companies.id, inv.companyId), eq(schema.companies.orgId, ws.org.id))).limit(1);
    contact = c?.phone?.trim() || undefined;
  }

  const res = await createPaymentLink(cfg, {
    amount: balance,
    currency: ws.org.currency,
    reference_id: paymentLinkReference(inv.number, randomBytes(4).toString("hex")),
    description: `Invoice ${inv.number} from ${ws.org.name}`.slice(0, 2000),
    customer: { name: inv.customerName, ...(inv.customerEmail ? { email: inv.customerEmail } : {}), ...(contact ? { contact } : {}) },
  });
  if (!res.ok) return { message: res.error };

  // Only one active link per invoice: retire the previous one (a failed cancel just means it was already closed).
  if (old) {
    await cancelPaymentLink(cfg, old.externalId);
    await db.update(schema.invoicePaymentLinks).set({ status: "cancelled" }).where(and(eq(schema.invoicePaymentLinks.id, old.id), eq(schema.invoicePaymentLinks.orgId, ws.org.id)));
  }
  await db.insert(schema.invoicePaymentLinks).values({ orgId: ws.org.id, invoiceId: inv.id, provider: "razorpay", externalId: res.data.id, url: res.data.short_url, amount: balance });
  await logActivity(ctxOf(ws), { module: "finance", entityType: "invoice", entityId: inv.id, action: "payment_link", summary: `Created payment link for ${inv.number}` });
  refresh();
  return { ok: true, message: "Payment link created." };
}

export async function cancelPaymentLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = Input.safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid invoice." };
  const { inv, link } = await load(ws.org.id, p.data.invoiceId);
  if (!inv || !link) return { message: "No active payment link." };
  const cfg = await getRazorpayConfig(ws.org.id);
  if (cfg) {
    const res = await cancelPaymentLink(cfg, link.externalId);
    if (!res.ok) return { message: res.error };
  }
  await db.update(schema.invoicePaymentLinks).set({ status: "cancelled" }).where(and(eq(schema.invoicePaymentLinks.id, link.id), eq(schema.invoicePaymentLinks.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "finance", entityType: "invoice", entityId: inv.id, action: "payment_link_cancelled", summary: `Cancelled payment link for ${inv.number}` });
  refresh();
  return { ok: true, message: "Payment link cancelled." };
}

export async function emailPaymentLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "finance" });
  const p = Input.safeParse(formObject(fd));
  if (!p.success) return { message: "Invalid invoice." };
  const { inv, link } = await load(ws.org.id, p.data.invoiceId);
  if (!inv || !link) return { message: "No active payment link." };
  if (!inv.customerEmail) return { message: "This invoice has no customer email." };
  const amountText = formatMoney(link.amount, ws.org.currency);
  const msg = paymentLinkMessage({ customerName: inv.customerName, invoiceNumber: inv.number, amountText, orgName: ws.org.name, url: link.url });
  const r = await sendEmail({
    to: inv.customerEmail,
    subject: `Pay invoice ${inv.number} — ${amountText} due`,
    paragraphs: [`Hi ${inv.customerName},`, `Invoice ${inv.number} from ${ws.org.name} has ${amountText} due (due date ${inv.dueDate}).`, "You can pay securely online with UPI, card or net banking."],
    action: { label: "Pay now", url: link.url },
  });
  if (!r.sent) return { message: `${r.error ?? "Email not sent."} Copy the link instead: ${link.url}`, values: { message: msg } };
  await logActivity(ctxOf(ws), { module: "finance", entityType: "invoice", entityId: inv.id, action: "payment_link_emailed", summary: `Emailed payment link for ${inv.number}` });
  return { ok: true, message: `Emailed to ${inv.customerEmail}.` };
}
