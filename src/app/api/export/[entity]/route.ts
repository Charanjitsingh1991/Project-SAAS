import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { canUseModule, getWorkspace, type ActiveWorkspace } from "@/lib/tenancy";
import type { ModuleKey } from "@/lib/roles";

type Row = Record<string, string | number | boolean | null | undefined>;
type Exporter = { module: ModuleKey; load: (orgId: number, params: URLSearchParams) => Promise<Row[]> };

const money = (minor: number | null | undefined) => ((minor ?? 0) / 100).toFixed(2);

const EXPORTS: Record<string, Exporter> = {
  employees: {
    module: "hrm",
    load: async (orgId) => {
      const rows = await db
        .select({ e: schema.employees, dept: schema.departments.name })
        .from(schema.employees)
        .leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
        .where(eq(schema.employees.orgId, orgId))
        .orderBy(schema.employees.code);
      return rows.map(({ e, dept }) => ({
        code: e.code, name: e.name, email: e.email, phone: e.phone, department: dept, designation: e.designation,
        employment_type: e.employmentType, status: e.status, join_date: e.joinDate, exit_date: e.exitDate,
        annual_ctc: money(e.annualCtc), work_location: e.workLocation,
      }));
    },
  },
  companies: {
    module: "crm",
    load: async (orgId) =>
      (await db.select().from(schema.companies).where(eq(schema.companies.orgId, orgId))).map((c) => ({
        name: c.name, industry: c.industry, website: c.website, phone: c.phone, gstin: c.gstin, city: c.city, state: c.state, country: c.country,
      })),
  },
  contacts: {
    module: "crm",
    load: async (orgId) => {
      const rows = await db
        .select({ c: schema.contacts, company: schema.companies.name })
        .from(schema.contacts)
        .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
        .where(eq(schema.contacts.orgId, orgId));
      return rows.map(({ c, company }) => ({ name: c.name, title: c.title, email: c.email, phone: c.phone, company, lifecycle: c.lifecycle, source: c.source }));
    },
  },
  deals: {
    module: "crm",
    load: async (orgId) => {
      const rows = await db
        .select({ d: schema.deals, company: schema.companies.name })
        .from(schema.deals)
        .leftJoin(schema.companies, eq(schema.deals.companyId, schema.companies.id))
        .where(eq(schema.deals.orgId, orgId))
        .orderBy(desc(schema.deals.createdAt));
      return rows.map(({ d, company }) => ({
        title: d.title, company, stage: d.stage, value: money(d.value), probability: d.probability, source: d.source,
        expected_close: d.expectedClose, lost_reason: d.lostReason,
      }));
    },
  },
  invoices: {
    module: "finance",
    load: async (orgId) =>
      (await db.select().from(schema.invoices).where(eq(schema.invoices.orgId, orgId)).orderBy(desc(schema.invoices.issueDate))).map((i) => ({
        number: i.number, customer: i.customerName, gstin: i.customerGstin, issue_date: i.issueDate, due_date: i.dueDate, status: i.status,
        subtotal: money(i.subtotal), tax: money(i.taxTotal), total: money(i.total), paid: money(i.amountPaid), balance: money(i.total - i.amountPaid),
      })),
  },
  expenses: {
    module: "finance",
    load: async (orgId) => {
      const rows = await db
        .select({ e: schema.expenses, vendor: schema.vendors.name })
        .from(schema.expenses)
        .leftJoin(schema.vendors, eq(schema.expenses.vendorId, schema.vendors.id))
        .where(eq(schema.expenses.orgId, orgId))
        .orderBy(desc(schema.expenses.date));
      return rows.map(({ e, vendor }) => ({
        date: e.date, description: e.description, vendor, category: e.category, amount: money(e.amount), gst: money(e.taxAmount), total: money(e.total),
        status: e.status, due_date: e.dueDate, paid_date: e.paidDate, source: e.sourceType,
      }));
    },
  },
  products: {
    module: "inventory",
    load: async (orgId) => {
      const prods = await db.select().from(schema.products).where(eq(schema.products.orgId, orgId)).orderBy(schema.products.sku);
      const levels = await db.select().from(schema.stockLevels).where(eq(schema.stockLevels.orgId, orgId));
      const onHand = new Map<number, number>();
      for (const l of levels) onHand.set(l.productId, (onHand.get(l.productId) ?? 0) + l.quantity);
      return prods.map((p) => ({
        sku: p.sku, name: p.name, barcode: p.barcode, category: p.category, unit: p.unit, on_hand: onHand.get(p.id) ?? 0,
        cost_price: money(p.costPrice), selling_price: money(p.sellingPrice), gst_rate: p.taxRate, reorder_level: p.reorderLevel,
        stock_value: money(Math.round((onHand.get(p.id) ?? 0) * p.costPrice)), active: p.active,
      }));
    },
  },
  stock_movements: {
    module: "inventory",
    load: async (orgId) => {
      const rows = await db
        .select({ m: schema.stockMovements, product: schema.products.name, sku: schema.products.sku, wh: schema.warehouses.name })
        .from(schema.stockMovements)
        .innerJoin(schema.products, eq(schema.stockMovements.productId, schema.products.id))
        .innerJoin(schema.warehouses, eq(schema.stockMovements.warehouseId, schema.warehouses.id))
        .where(eq(schema.stockMovements.orgId, orgId))
        .orderBy(desc(schema.stockMovements.id));
      return rows.map(({ m, product, sku, wh }) => ({
        date: m.createdAt.toISOString(), sku, product, warehouse: wh, type: m.type, quantity: m.quantity, unit_cost: money(m.unitCost), reference: m.reference, note: m.note,
      }));
    },
  },
  projects: {
    module: "projects",
    load: async (orgId) => {
      const rows = await db
        .select({ p: schema.projects, client: schema.companies.name })
        .from(schema.projects)
        .leftJoin(schema.companies, eq(schema.projects.companyId, schema.companies.id))
        .where(eq(schema.projects.orgId, orgId));
      return rows.map(({ p, client }) => ({
        code: p.code, name: p.name, client, status: p.status, billing: p.billingType, budget: money(p.budget), hourly_rate: money(p.hourlyRate), start: p.startDate, due: p.dueDate,
      }));
    },
  },
  time_entries: {
    module: "projects",
    load: async (orgId) => {
      const rows = await db
        .select({ t: schema.timeEntries, project: schema.projects.code, task: schema.tasks.title, employee: schema.employees.name })
        .from(schema.timeEntries)
        .innerJoin(schema.projects, eq(schema.timeEntries.projectId, schema.projects.id))
        .innerJoin(schema.employees, eq(schema.timeEntries.employeeId, schema.employees.id))
        .leftJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(eq(schema.timeEntries.orgId, orgId))
        .orderBy(desc(schema.timeEntries.date));
      return rows.map(({ t, project, task, employee }) => ({
        date: t.date, employee, project, task, hours: t.hours, billable: t.billable, invoiced: !!t.invoiceId, description: t.description,
      }));
    },
  },
  tickets: {
    module: "helpdesk",
    load: async (orgId) =>
      (await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, orgId)).orderBy(desc(schema.tickets.createdAt))).map((t) => ({
        number: t.number, subject: t.subject, requester: t.requesterName, email: t.requesterEmail, channel: t.channel, category: t.category,
        priority: t.priority, status: t.status, created: t.createdAt.toISOString(), first_response: t.firstRespondedAt?.toISOString(),
        resolved: t.resolvedAt?.toISOString(), csat: t.csatRating,
      })),
  },
  payslips: {
    module: "payroll",
    load: async (orgId, params) => {
      const runId = Number(params.get("run"));
      const where = runId ? and(eq(schema.payslips.orgId, orgId), eq(schema.payslips.runId, runId)) : eq(schema.payslips.orgId, orgId);
      const rows = await db
        .select({ s: schema.payslips, period: schema.payrollRuns.period, bank: schema.employees.bankAccount, ifsc: schema.employees.ifsc })
        .from(schema.payslips)
        .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
        .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
        .where(and(where, inArray(schema.payrollRuns.status, ["draft", "approved", "paid"])));
      return rows.map(({ s, period, bank, ifsc }) => ({
        period, code: s.employeeCode, name: s.employeeName, bank_account: bank, ifsc, paid_days: s.paidDays, lop_days: s.lopDays,
        gross: money(s.gross), pf: money(s.pfEmployee), esi: money(s.esiEmployee), pt: money(s.professionalTax), tds: money(s.tds),
        other_deductions: money(s.otherDeductions), net: money(s.net),
      }));
    },
  },
};

function toCsv(rows: Row[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: Row[string]) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // Prefix formula-like values so spreadsheets don't execute them.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export async function GET(req: Request, ctx: RouteContext<"/api/export/[entity]">) {
  const { entity } = await ctx.params;
  const exporter = EXPORTS[entity];
  if (!exporter) return new Response("Unknown export", { status: 404 });
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access || ws.access.state === "locked") return new Response("Unauthorized", { status: 401 });
  if (!canUseModule(ws as ActiveWorkspace, exporter.module)) return new Response("Forbidden", { status: 403 });

  const rows = await exporter.load(ws.org.id, new URL(req.url).searchParams);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${toCsv(rows)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${entity}-${date}.csv"`,
    },
  });
}
