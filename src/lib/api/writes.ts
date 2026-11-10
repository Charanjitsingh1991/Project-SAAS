import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { logActivity } from "@/lib/activity";
import { emitEvent } from "@/lib/integrations/events";
import { apiError, apiJson, readJson, withApi, type ApiCtx } from "@/lib/api-auth";
import { isYmd } from "@/lib/api-keys";
import { defaultTaxRate, packOf } from "@/lib/countries";
import { createTicket, isMember } from "@/lib/helpdesk-data";
import { createDraftInvoice, type InvoiceLineInput } from "@/lib/posting";
import { serializeCompany, serializeContact, serializeDeal, serializeInvoice, serializeTicket } from "./resources";

/*
 * POST handlers for /api/v1 (write scope). Foreign ids are validated against the key's org.
 * Invoices are created as DRAFT through posting.ts; nothing here posts to the ledger.
 */

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) => str(max).nullish().transform((v) => (v ? v : null));
const id = z.number().int().positive();
const ymd = z.string().refine(isYmd, "must be a date in YYYY-MM-DD format");
const minor = z.number().int("must be an integer in minor units").min(0).max(1_000_000_000_000);

const ContactBody = z.object({
  name: str(160).min(1, "is required"),
  title: optStr(120),
  email: z.email().max(200).nullish().transform((v) => (v ? v.toLowerCase() : null)),
  phone: optStr(40),
  company_id: id.nullish(),
  lifecycle: z.enum(schema.LIFECYCLES).default("lead"),
  source: z.enum(schema.LEAD_SOURCES).default("other"),
});

const CompanyBody = z.object({
  name: str(160).min(1, "is required"),
  industry: optStr(120),
  website: optStr(200),
  phone: optStr(40),
  tax_id: optStr(40),
  billing_address: optStr(400),
  city: optStr(120),
  state: optStr(120),
  country: optStr(80),
});

const DealBody = z.object({
  title: str(200).min(1, "is required"),
  company_id: id.nullish(),
  contact_id: id.nullish(),
  value: minor.default(0),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation"]).default("lead"),
  source: z.enum(schema.LEAD_SOURCES).default("other"),
  expected_close: ymd.nullish(),
});

const TicketBody = z.object({
  subject: str(200).min(1, "is required"),
  description: optStr(10_000),
  requester_name: str(160).min(1, "is required"),
  requester_email: z.email().max(200),
  channel: z.enum(schema.TICKET_CHANNELS).default("web"),
  category: optStr(80),
  priority: z.enum(schema.PRIORITIES).default("medium"),
  assignee_id: id.nullish(),
});

const InvoiceBody = z.object({
  company_id: id.nullish(),
  customer_name: str(200).nullish(),
  customer_email: z.email().max(200).nullish(),
  issue_date: ymd.optional(),
  due_date: ymd.optional(),
  notes: optStr(2000),
  lines: z
    .array(
      z.object({
        product_id: id.nullish(),
        description: str(300).nullish(),
        quantity: z.number().positive().max(1_000_000).default(1),
        unit_price: minor.optional(),
        tax_rate: z.number().min(0).max(100).optional(),
        tax_code: str(20).nullish(),
      }),
    )
    .min(1, "must contain at least one line")
    .max(100),
});

function validationError(err: z.ZodError) {
  const i = err.issues[0];
  const path = i.path.join(".");
  return apiError(422, "validation_error", path ? `${path}: ${i.message}` : i.message);
}

/** Parse the JSON body with a schema; returns the data or an error Response. */
async function parse<T extends z.ZodType>(req: Request, schemaDef: T): Promise<z.output<T> | Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const r = schemaDef.safeParse(body);
  return r.success ? r.data : validationError(r.error);
}

const log = (ctx: ApiCtx, module: "crm" | "finance" | "helpdesk", entityType: string, entityId: number, summary: string) =>
  logActivity({ orgId: ctx.orgId, userId: ctx.actorId }, { module, entityType, entityId, action: "created", summary: `${summary} (via API key "${ctx.keyName}")` });

async function companyInOrg(ctx: ApiCtx, companyId: number | null | undefined) {
  if (!companyId) return null;
  const [c] = await db.select().from(schema.companies).where(and(eq(schema.companies.id, companyId), eq(schema.companies.orgId, ctx.orgId))).limit(1);
  return c ?? null;
}

const notFound = (field: string) => apiError(422, "validation_error", `${field}: not found in this workspace`);

export const postContact = (req: Request) =>
  withApi(req, { module: "crm", write: true }, async (ctx) => {
    const b = await parse(req, ContactBody);
    if (b instanceof Response) return b;
    if (b.company_id && !(await companyInOrg(ctx, b.company_id))) return notFound("company_id");
    const [row] = await db
      .insert(schema.contacts)
      .values({ orgId: ctx.orgId, name: b.name, title: b.title, email: b.email, phone: b.phone, companyId: b.company_id ?? null, lifecycle: b.lifecycle, source: b.source, ownerId: ctx.actorId })
      .returning();
    await log(ctx, "crm", "contact", row.id, `Added contact ${row.name}`);
    await emitEvent({ orgId: ctx.orgId, userId: ctx.actorId }, "contact.created", { id: row.id, name: row.name, email: row.email ?? null });
    return apiJson({ data: serializeContact(row) }, { status: 201 });
  });

export const postCompany = (req: Request) =>
  withApi(req, { module: "crm", write: true }, async (ctx) => {
    const b = await parse(req, CompanyBody);
    if (b instanceof Response) return b;
    const [row] = await db
      .insert(schema.companies)
      .values({
        orgId: ctx.orgId, name: b.name, industry: b.industry, website: b.website, phone: b.phone, gstin: b.tax_id, billingAddress: b.billing_address,
        city: b.city, state: b.state, ...(b.country ? { country: b.country } : {}), ownerId: ctx.actorId,
      })
      .returning();
    await log(ctx, "crm", "company", row.id, `Added company ${row.name}`);
    await emitEvent({ orgId: ctx.orgId, userId: ctx.actorId }, "company.created", { id: row.id, name: row.name });
    return apiJson({ data: serializeCompany(row) }, { status: 201 });
  });

export const postDeal = (req: Request) =>
  withApi(req, { module: "crm", write: true }, async (ctx) => {
    const b = await parse(req, DealBody);
    if (b instanceof Response) return b;
    if (b.company_id && !(await companyInOrg(ctx, b.company_id))) return notFound("company_id");
    if (b.contact_id) {
      const [c] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.id, b.contact_id), eq(schema.contacts.orgId, ctx.orgId))).limit(1);
      if (!c) return notFound("contact_id");
    }
    const [row] = await db
      .insert(schema.deals)
      .values({
        orgId: ctx.orgId, title: b.title, companyId: b.company_id ?? null, contactId: b.contact_id ?? null, ownerId: ctx.actorId, value: b.value,
        stage: b.stage, probability: schema.STAGE_PROBABILITY[b.stage], source: b.source, expectedClose: b.expected_close ?? null,
      })
      .returning();
    await log(ctx, "crm", "deal", row.id, `Created deal ${row.title} in ${row.stage}`);
    await emitEvent({ orgId: ctx.orgId, userId: ctx.actorId }, "deal.created", { id: row.id, title: row.title, value: row.value, stage: row.stage });
    return apiJson({ data: serializeDeal(row, ctx) }, { status: 201 });
  });

export const postTicket = (req: Request) =>
  withApi(req, { module: "helpdesk", write: true }, async (ctx) => {
    const b = await parse(req, TicketBody);
    if (b instanceof Response) return b;
    if (b.assignee_id && !(await isMember(ctx.orgId, b.assignee_id))) return notFound("assignee_id");
    const created = await createTicket(
      ctx.orgId,
      {
        subject: b.subject, description: b.description, requesterName: b.requester_name, requesterEmail: b.requester_email,
        channel: b.channel, category: b.category, priority: b.priority, assigneeId: b.assignee_id ?? null,
      },
      { userId: ctx.actorId, actor: `API key "${ctx.keyName}"` },
    );
    const [row] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, created.id), eq(schema.tickets.orgId, ctx.orgId))).limit(1);
    return apiJson({ data: serializeTicket(row) }, { status: 201 });
  });

export const postInvoice = (req: Request) =>
  withApi(req, { module: "finance", write: true }, async (ctx) => {
    const b = await parse(req, InvoiceBody);
    if (b instanceof Response) return b;

    const company = await companyInOrg(ctx, b.company_id);
    if (b.company_id && !company) return notFound("company_id");
    const customerName = b.customer_name || company?.name;
    if (!customerName) return apiError(422, "validation_error", "customer_name: is required when company_id is not given");
    if (b.issue_date && b.due_date && b.due_date < b.issue_date) return apiError(422, "validation_error", "due_date: must not be before issue_date");

    const productIds = [...new Set(b.lines.map((l) => l.product_id).filter((v): v is number => !!v))];
    const products = productIds.length
      ? await db.select().from(schema.products).where(and(eq(schema.products.orgId, ctx.orgId), inArray(schema.products.id, productIds)))
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const fallbackRate = defaultTaxRate(packOf({ country: ctx.country }));

    const lines: InvoiceLineInput[] = [];
    for (const [i, l] of b.lines.entries()) {
      const p = l.product_id ? byId.get(l.product_id) : undefined;
      if (l.product_id && !p) return notFound(`lines.${i}.product_id`);
      const description = l.description || p?.name;
      if (!description) return apiError(422, "validation_error", `lines.${i}.description: is required when product_id is not given`);
      const unitPrice = l.unit_price ?? p?.sellingPrice;
      if (unitPrice === undefined) return apiError(422, "validation_error", `lines.${i}.unit_price: is required when product_id is not given`);
      lines.push({ productId: p?.id ?? null, description, quantity: l.quantity, unitPrice, taxRate: l.tax_rate ?? p?.taxRate ?? fallbackRate, taxCode: l.tax_code ?? null });
    }

    const created = await createDraftInvoice(
      { orgId: ctx.orgId, userId: ctx.actorId },
      {
        companyId: company?.id ?? null, customerName, customerEmail: b.customer_email ?? null, billingAddress: company?.billingAddress ?? null,
        customerGstin: company?.gstin ?? null, placeOfSupply: company?.state ?? null, issueDate: b.issue_date, dueDate: b.due_date, notes: b.notes,
      },
      lines,
    );
    const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, created.id), eq(schema.invoices.orgId, ctx.orgId))).limit(1);
    const rows = await db.select().from(schema.invoiceLines).where(and(eq(schema.invoiceLines.invoiceId, created.id), eq(schema.invoiceLines.orgId, ctx.orgId))).orderBy(schema.invoiceLines.sortOrder);
    await log(ctx, "finance", "invoice", created.id, `Created draft invoice ${created.number}`);
    return apiJson({ data: { ...serializeInvoice(inv, ctx), lines: rows.map((r) => serializeLine(r)) } }, { status: 201 });
  });

export function serializeLine(r: typeof schema.invoiceLines.$inferSelect) {
  return {
    id: r.id, product_id: r.productId, description: r.description, quantity: r.quantity, unit_price: r.unitPrice, tax_rate: r.taxRate, tax_code: r.taxCode,
    amount: r.amount, tax_amount: r.taxAmount,
  };
}
