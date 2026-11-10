"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ctxOf, logActivity } from "@/lib/activity";
import type { FormState } from "@/lib/definitions";
import { formObject, todayYmd, toMinor } from "@/lib/format";
import { convertQuoteToInvoice } from "@/lib/posting";
import { canConvertQuote, canMoveQuote, computeQuoteLines, quoteDisplayStatus, type QuoteStatus } from "@/lib/quotes";
import { packFor, planModules, requireWorkspace } from "@/lib/tenancy";

type Ws = Awaited<ReturnType<typeof requireWorkspace>>;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");
const optId = z.coerce.number().int().positive().optional();
const fail = (e: z.ZodError): FormState => ({ errors: z.flattenError(e).fieldErrors, message: "Please fix the highlighted fields." });
const quoteUrl = (id: number, qs = "") => `/app/crm/quotes/${id}${qs}`;

/** QT-0001 numbering on the shared per-workspace sequences table. */
async function nextQuoteNumber(orgId: number) {
  const [row] = await db
    .insert(schema.sequences)
    .values({ orgId, key: "quote", next: 2 })
    .onConflictDoUpdate({ target: [schema.sequences.orgId, schema.sequences.key], set: { next: sql`${schema.sequences.next} + 1` } })
    .returning({ next: schema.sequences.next });
  return `QT-${String(row.next - 1).padStart(4, "0")}`;
}

const HeaderSchema = z.object({
  dealId: optId,
  companyId: optId,
  contactId: optId,
  customerName: z.string().trim().max(160).optional(),
  customerEmail: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email.")).optional(),
  placeOfSupply: z.string().trim().max(80).optional(),
  issueDate: ymd,
  validUntil: ymd,
  terms: z.string().trim().max(2000).optional(),
  lines: z.string().min(2, "Add at least one line."),
});

const LineSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1, "Describe every line.").max(300),
  quantity: z.number("Enter a quantity on every line.").positive("Quantity must be above zero."),
  unitPrice: z.number("Enter a price on every line.").min(0, "Price can't be negative."),
  discountPercent: z.number().min(0, "Discount 0–100%.").max(100, "Discount 0–100%.").default(0),
  taxCode: z.string().max(20),
});

const getDeal = async (orgId: number, id: number) =>
  (await db.select().from(schema.deals).where(and(eq(schema.deals.id, id), eq(schema.deals.orgId, orgId))).limit(1))[0];
const getCompany = async (orgId: number, id: number) =>
  (await db.select().from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, orgId))).limit(1))[0];
const getContact = async (orgId: number, id: number) =>
  (await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId))).limit(1))[0];

/** Validate header + lines and resolve the customer from company/contact/deal. */
async function buildQuote(ws: Ws, fd: FormData) {
  const parsed = HeaderSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false as const, error: fail(parsed.error) };
  const d = parsed.data;
  const orgId = ws.org.id;
  const pack = packFor(ws);
  const errors: Record<string, string[]> = {};

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(d.lines);
  } catch {
    rawLines = null;
  }
  const lp = z.array(LineSchema).min(1, "Add at least one line.").safeParse(rawLines);
  if (!lp.success) {
    const message = lp.error.issues[0]?.message ?? "Check the lines.";
    return { ok: false as const, error: { errors: { lines: [message] }, message } as FormState };
  }
  if (lp.data.some((l) => !pack.tax.rates.some((r) => r.code === l.taxCode))) errors.lines = [`Pick a valid ${pack.tax.name} rate on every line.`];
  const productIds = [...new Set(lp.data.map((l) => l.productId).filter((x): x is number => !!x))];
  if (productIds.length) {
    const ok = await db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.orgId, orgId), inArray(schema.products.id, productIds)));
    if (ok.length !== productIds.length) errors.lines = ["One or more products are invalid."];
  }

  const deal = d.dealId ? await getDeal(orgId, d.dealId) : undefined;
  if (d.dealId && !deal) errors.dealId = ["Choose a valid deal."];
  const companyId = d.companyId ?? deal?.companyId ?? undefined;
  const contactId = d.contactId ?? deal?.contactId ?? undefined;
  const company = companyId ? await getCompany(orgId, companyId) : undefined;
  if (companyId && !company) errors.companyId = ["Choose a valid company."];
  const contact = contactId ? await getContact(orgId, contactId) : undefined;
  if (contactId && !contact) errors.contactId = ["Choose a valid contact."];
  const customerName = d.customerName || company?.name || contact?.name;
  if (!customerName) errors.customerName = ["Pick a company or contact, or type a customer name."];
  if (d.validUntil < d.issueDate) errors.validUntil = ["Validity must be on or after the quote date."];
  if (d.placeOfSupply && !pack.regions.includes(d.placeOfSupply)) errors.placeOfSupply = [`Choose a valid ${pack.regionLabel.toLowerCase()}.`];
  if (Object.keys(errors).length) return { ok: false as const, error: { errors, message: errors.lines?.[0] ?? "Please fix the highlighted fields." } as FormState };

  const totals = computeQuoteLines(
    pack.tax.rates,
    lp.data.map((l) => ({ ...l, productId: l.productId ?? null, unitPrice: toMinor(l.unitPrice) })),
  );
  const header = {
    dealId: deal?.id ?? null,
    companyId: company?.id ?? null,
    contactId: contact?.id ?? null,
    customerName: customerName!,
    customerEmail: d.customerEmail ?? contact?.email ?? null,
    placeOfSupply: d.placeOfSupply ?? company?.state ?? null,
    issueDate: d.issueDate,
    validUntil: d.validUntil,
    terms: d.terms ?? null,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
  };
  return { ok: true as const, header, totals };
}

async function writeLines(orgId: number, quoteId: number, lines: ReturnType<typeof computeQuoteLines>["lines"]) {
  await db.delete(schema.quoteLines).where(and(eq(schema.quoteLines.quoteId, quoteId), eq(schema.quoteLines.orgId, orgId)));
  await db.insert(schema.quoteLines).values(
    lines.map((l) => ({
      orgId,
      quoteId,
      productId: l.productId ?? null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRate: l.taxRate,
      taxCode: l.taxCode,
      amount: l.amount,
      taxAmount: l.taxAmount,
      sortOrder: l.sortOrder,
    })),
  );
}

async function loadQuote(orgId: number, id: number) {
  if (!Number.isInteger(id)) return undefined;
  const [q] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.id, id), eq(schema.quotes.orgId, orgId))).limit(1);
  return q;
}

export async function createQuote(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const built = await buildQuote(ws, fd);
  if (!built.ok) return built.error;
  const orgId = ws.org.id;
  const number = await nextQuoteNumber(orgId);
  const [q] = await db.insert(schema.quotes).values({ orgId, number, status: "draft", ...built.header }).returning({ id: schema.quotes.id });
  await writeLines(orgId, q.id, built.totals.lines);
  await logActivity(ctxOf(ws), { module: "crm", entityType: "quote", entityId: q.id, action: "created", summary: `Created quote ${number} for ${built.header.customerName}` });
  redirect(quoteUrl(q.id));
}

export async function updateQuote(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await requireWorkspace({ module: "crm" });
  const q = await loadQuote(ws.org.id, Number(fd.get("id")));
  if (!q) return { message: "Quote not found." };
  if (q.status !== "draft") return { message: "Only draft quotes can be edited. Revise it back to draft first." };
  const built = await buildQuote(ws, fd);
  if (!built.ok) return built.error;
  await db.update(schema.quotes).set(built.header).where(and(eq(schema.quotes.id, q.id), eq(schema.quotes.orgId, ws.org.id)));
  await writeLines(ws.org.id, q.id, built.totals.lines);
  await logActivity(ctxOf(ws), { module: "crm", entityType: "quote", entityId: q.id, action: "updated", summary: `Updated quote ${q.number}` });
  redirect(quoteUrl(q.id));
}

const TARGETS = ["draft", "sent", "accepted", "declined"] as const;

export async function setQuoteStatus(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const q = await loadQuote(ws.org.id, Number(fd.get("id")));
  if (!q) redirect("/app/crm/quotes");
  const to = z.enum(TARGETS).safeParse(fd.get("status"));
  const display = quoteDisplayStatus(q, todayYmd());
  if (!to.success || !canMoveQuote(display, to.data as QuoteStatus)) {
    redirect(quoteUrl(q.id, `?error=${encodeURIComponent(display === "expired" ? "This quote has expired. Revise it to draft and extend the validity date." : "That status change isn't allowed.")}`));
  }
  await db.update(schema.quotes).set({ status: to.data }).where(and(eq(schema.quotes.id, q.id), eq(schema.quotes.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "crm", entityType: "quote", entityId: q.id, action: `status_${to.data}`, summary: `Quote ${q.number}: ${display} → ${to.data}` });
  refresh();
}

export async function convertQuote(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const q = await loadQuote(ws.org.id, Number(fd.get("id")));
  if (!q) redirect("/app/crm/quotes");
  if (!planModules(ws).includes("finance")) redirect(quoteUrl(q.id, `?error=${encodeURIComponent("Turn on the Finance module to convert quotes into invoices.")}`));
  if (!canConvertQuote(quoteDisplayStatus(q, todayYmd()))) redirect(quoteUrl(q.id, `?error=${encodeURIComponent("Only sent (still valid) or accepted quotes can be invoiced.")}`));
  const res = await convertQuoteToInvoice(ctxOf(ws), q.id);
  if ("error" in res) redirect(quoteUrl(q.id, `?error=${encodeURIComponent(res.error)}`));
  redirect(quoteUrl(q.id, `?invoiced=${encodeURIComponent(res.number)}`));
}

export async function deleteQuote(fd: FormData) {
  const ws = await requireWorkspace({ module: "crm" });
  const q = await loadQuote(ws.org.id, Number(fd.get("id")));
  if (!q) redirect("/app/crm/quotes");
  if (q.status === "invoiced") redirect(quoteUrl(q.id, `?error=${encodeURIComponent("Invoiced quotes can't be deleted.")}`));
  await db.delete(schema.quoteLines).where(and(eq(schema.quoteLines.quoteId, q.id), eq(schema.quoteLines.orgId, ws.org.id)));
  await db.delete(schema.quotes).where(and(eq(schema.quotes.id, q.id), eq(schema.quotes.orgId, ws.org.id)));
  await logActivity(ctxOf(ws), { module: "crm", entityType: "quote", entityId: q.id, action: "deleted", summary: `Deleted quote ${q.number}` });
  redirect("/app/crm/quotes");
}
