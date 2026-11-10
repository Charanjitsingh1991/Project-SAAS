import "server-only";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiError, apiJson, withApi, type ApiCtx } from "@/lib/api-auth";
import { pageOf, parsePagination } from "@/lib/api-keys";
import type { ModuleKey } from "@/lib/roles";

/*
 * Read-only resource definitions for /api/v1. Every query is scoped by orgId.
 * Money is returned as integer minor units with a `currency` code.
 * Sensitive fields (salary, bank, PAN/Aadhaar/Emirates ID, passport, ticket tokens) are never selected.
 */

type Q = { limit: number; afterId: number | null; params: URLSearchParams };
type Out = { id: number } & Record<string, unknown>;
export type Resource = { module: ModuleKey; load: (ctx: ApiCtx, q: Q) => Promise<Out[]> };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const intParam = (p: URLSearchParams, k: string) => {
  const v = p.get(k);
  return v && /^\d{1,15}$/.test(v) ? Number(v) : null;
};

/** `col > afterId` plus caller filters, org-scoped. */
function scope(orgCol: Parameters<typeof eq>[0], idCol: Parameters<typeof gt>[0], ctx: ApiCtx, q: Q, extra: (SQL | undefined)[] = []) {
  return and(eq(orgCol, ctx.orgId), q.afterId !== null ? gt(idCol, q.afterId) : undefined, ...extra);
}

const enumParam = <T extends string>(p: URLSearchParams, k: string, allowed: readonly T[]) => {
  const v = p.get(k);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
};

export const RESOURCES: Record<string, Resource> = {
  contacts: {
    module: "crm",
    load: async (ctx, q) => {
      const t = schema.contacts;
      const email = q.params.get("email")?.trim().toLowerCase();
      const companyId = intParam(q.params, "company_id");
      const rows = await db
        .select()
        .from(t)
        .where(scope(t.orgId, t.id, ctx, q, [email ? sql`lower(${t.email}) = ${email}` : undefined, companyId ? eq(t.companyId, companyId) : undefined]))
        .orderBy(asc(t.id))
        .limit(q.limit + 1);
      return rows.map(serializeContact);
    },
  },
  companies: {
    module: "crm",
    load: async (ctx, q) => {
      const t = schema.companies;
      const rows = await db.select().from(t).where(scope(t.orgId, t.id, ctx, q)).orderBy(asc(t.id)).limit(q.limit + 1);
      return rows.map(serializeCompany);
    },
  },
  deals: {
    module: "crm",
    load: async (ctx, q) => {
      const t = schema.deals;
      const stage = enumParam(q.params, "stage", schema.DEAL_STAGES);
      const rows = await db.select().from(t).where(scope(t.orgId, t.id, ctx, q, [stage ? eq(t.stage, stage) : undefined])).orderBy(asc(t.id)).limit(q.limit + 1);
      return rows.map((d) => serializeDeal(d, ctx));
    },
  },
  invoices: {
    module: "finance",
    load: async (ctx, q) => {
      const t = schema.invoices;
      const status = enumParam(q.params, "status", schema.INVOICE_STATUSES);
      const companyId = intParam(q.params, "company_id");
      const rows = await db
        .select()
        .from(t)
        .where(scope(t.orgId, t.id, ctx, q, [status ? eq(t.status, status) : undefined, companyId ? eq(t.companyId, companyId) : undefined]))
        .orderBy(asc(t.id))
        .limit(q.limit + 1);
      return rows.map((i) => serializeInvoice(i, ctx));
    },
  },
  payments: {
    module: "finance",
    load: async (ctx, q) => {
      const t = schema.payments;
      const invoiceId = intParam(q.params, "invoice_id");
      const rows = await db.select().from(t).where(scope(t.orgId, t.id, ctx, q, [invoiceId ? eq(t.invoiceId, invoiceId) : undefined])).orderBy(asc(t.id)).limit(q.limit + 1);
      return rows.map((p) => ({
        id: p.id, invoice_id: p.invoiceId, date: p.date, amount: p.amount, currency: ctx.currency, method: p.method, reference: p.reference, created_at: iso(p.createdAt),
      }));
    },
  },
  products: {
    module: "inventory",
    load: async (ctx, q) => {
      const t = schema.products;
      const rows = await db.select().from(t).where(scope(t.orgId, t.id, ctx, q)).orderBy(asc(t.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const stock = new Map<number, number>();
      if (page.length) {
        const levels = await db
          .select({ productId: schema.stockLevels.productId, qty: sql<number>`sum(${schema.stockLevels.quantity})` })
          .from(schema.stockLevels)
          .where(and(eq(schema.stockLevels.orgId, ctx.orgId), inArray(schema.stockLevels.productId, page.map((p) => p.id))))
          .groupBy(schema.stockLevels.productId);
        for (const l of levels) stock.set(l.productId, Number(l.qty) || 0);
      }
      // The extra (limit+1) row is passed through so pageOf() can detect another page.
      return rows.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, barcode: p.barcode, category: p.category, unit: p.unit,
        cost_price: p.costPrice, selling_price: p.sellingPrice, currency: ctx.currency, tax_rate: p.taxRate,
        reorder_level: p.reorderLevel, track_stock: p.trackStock, active: p.active, stock_on_hand: stock.get(p.id) ?? 0, created_at: iso(p.createdAt),
      }));
    },
  },
  employees: {
    module: "hrm",
    load: async (ctx, q) => {
      const t = schema.employees;
      const status = enumParam(q.params, "status", schema.EMPLOYEE_STATUSES);
      const rows = await db
        .select({ e: t, dept: schema.departments.name })
        .from(t)
        .leftJoin(schema.departments, eq(t.departmentId, schema.departments.id))
        .where(scope(t.orgId, t.id, ctx, q, [status ? eq(t.status, status) : undefined]))
        .orderBy(asc(t.id))
        .limit(q.limit + 1);
      return rows.map(({ e, dept }) => ({
        id: e.id, code: e.code, name: e.name, email: e.email, phone: e.phone, department: dept, designation: e.designation, manager_id: e.managerId,
        employment_type: e.employmentType, work_location: e.workLocation, status: e.status, join_date: e.joinDate, exit_date: e.exitDate,
      }));
    },
  },
  "leave-requests": {
    module: "hrm",
    load: async (ctx, q) => {
      const t = schema.leaveRequests;
      const status = enumParam(q.params, "status", ["pending", "approved", "rejected", "cancelled"] as const);
      const employeeId = intParam(q.params, "employee_id");
      const rows = await db
        .select({ r: t, type: schema.leaveTypes.name, code: schema.employees.code })
        .from(t)
        .innerJoin(schema.employees, and(eq(t.employeeId, schema.employees.id), eq(schema.employees.orgId, ctx.orgId)))
        .innerJoin(schema.leaveTypes, and(eq(t.leaveTypeId, schema.leaveTypes.id), eq(schema.leaveTypes.orgId, ctx.orgId)))
        .where(scope(t.orgId, t.id, ctx, q, [status ? eq(t.status, status) : undefined, employeeId ? eq(t.employeeId, employeeId) : undefined]))
        .orderBy(asc(t.id))
        .limit(q.limit + 1);
      return rows.map(({ r, type, code }) => ({
        id: r.id, employee_id: r.employeeId, employee_code: code, leave_type: type, start_date: r.startDate, end_date: r.endDate, half_day: r.halfDay,
        days: r.days, status: r.status, created_at: iso(r.createdAt),
      }));
    },
  },
  tickets: {
    module: "helpdesk",
    load: async (ctx, q) => {
      const t = schema.tickets;
      const status = enumParam(q.params, "status", schema.TICKET_STATUSES);
      const rows = await db.select().from(t).where(scope(t.orgId, t.id, ctx, q, [status ? eq(t.status, status) : undefined])).orderBy(asc(t.id)).limit(q.limit + 1);
      return rows.map(serializeTicket);
    },
  },
  projects: {
    module: "projects",
    load: async (ctx, q) => {
      const t = schema.projects;
      const rows = await db.select().from(t).where(scope(t.orgId, t.id, ctx, q)).orderBy(asc(t.id)).limit(q.limit + 1);
      return rows.map((p) => ({
        id: p.id, code: p.code, name: p.name, company_id: p.companyId, description: p.description, status: p.status, billing_type: p.billingType,
        budget: p.budget, hourly_rate: p.hourlyRate, currency: ctx.currency, start_date: p.startDate, due_date: p.dueDate, created_at: iso(p.createdAt),
      }));
    },
  },
  tasks: {
    module: "projects",
    load: async (ctx, q) => {
      const t = schema.tasks;
      const projectId = intParam(q.params, "project_id");
      const status = enumParam(q.params, "status", schema.TASK_STATUSES);
      const rows = await db
        .select()
        .from(t)
        .where(scope(t.orgId, t.id, ctx, q, [projectId ? eq(t.projectId, projectId) : undefined, status ? eq(t.status, status) : undefined]))
        .orderBy(asc(t.id))
        .limit(q.limit + 1);
      return rows.map((k) => ({
        id: k.id, project_id: k.projectId, title: k.title, description: k.description, assignee_id: k.assigneeId, status: k.status, priority: k.priority,
        start_date: k.startDate, due_date: k.dueDate, estimate_hours: k.estimateHours, completed_at: iso(k.completedAt), created_at: iso(k.createdAt),
      }));
    },
  },
};

export function serializeContact(c: typeof schema.contacts.$inferSelect): Out {
  return { id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone, company_id: c.companyId, lifecycle: c.lifecycle, source: c.source, created_at: iso(c.createdAt) };
}

export function serializeCompany(c: typeof schema.companies.$inferSelect): Out {
  return {
    id: c.id, name: c.name, industry: c.industry, website: c.website, phone: c.phone, tax_id: c.gstin, billing_address: c.billingAddress,
    city: c.city, state: c.state, country: c.country, created_at: iso(c.createdAt),
  };
}

export function serializeDeal(d: typeof schema.deals.$inferSelect, ctx: ApiCtx): Out {
  return {
    id: d.id, title: d.title, company_id: d.companyId, contact_id: d.contactId, value: d.value, currency: ctx.currency, stage: d.stage, probability: d.probability,
    source: d.source, expected_close: d.expectedClose, created_at: iso(d.createdAt),
  };
}

export function serializeInvoice(i: typeof schema.invoices.$inferSelect, ctx: ApiCtx): Out {
  return {
    id: i.id, number: i.number, company_id: i.companyId, customer_name: i.customerName, customer_email: i.customerEmail, issue_date: i.issueDate, due_date: i.dueDate,
    status: i.status, subtotal: i.subtotal, tax_total: i.taxTotal, total: i.total, amount_paid: i.amountPaid, amount_credited: i.amountCredited,
    balance_due: i.total - i.amountPaid - i.amountCredited, currency: ctx.currency, created_at: iso(i.createdAt),
  };
}

export function serializeTicket(t: typeof schema.tickets.$inferSelect): Out {
  return {
    id: t.id, number: t.number, subject: t.subject, description: t.description, requester_name: t.requesterName, requester_email: t.requesterEmail,
    contact_id: t.contactId, company_id: t.companyId, channel: t.channel, category: t.category, priority: t.priority, status: t.status, assignee_id: t.assigneeId,
    resolved_at: iso(t.resolvedAt), created_at: iso(t.createdAt),
  };
}

/** Shared GET /v1/<resource> handler. */
export async function listResource(req: Request, ctx: ApiCtx, name: string) {
  const res = RESOURCES[name];
  const url = new URL(req.url);
  const page = parsePagination(url.searchParams);
  if ("error" in page) return apiError(400, "invalid_request", page.error);
  const rows = await res.load(ctx, { limit: page.limit, afterId: page.afterId, params: url.searchParams });
  const { data, hasMore, nextCursor } = pageOf(rows, page.limit);
  return apiJson({ data, has_more: hasMore, next_cursor: nextCursor });
}

/** Route handler factory for GET /api/v1/<name>. */
export function listRoute(name: string) {
  return (req: Request) => withApi(req, { module: RESOURCES[name].module }, (ctx) => listResource(req, ctx, name));
}
